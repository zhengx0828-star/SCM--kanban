"""数据库引擎与会话管理。

两种后端，靠环境变量切换：

  SQLite（默认，本地开发 / 单机部署）
      SCM_DB_PATH=/data/products.db     # 库文件路径，默认 backend/products.db

  MySQL / OceanBase(MySQL 模式)
      SCM_DB_URL=mysql+pymysql://user:pass@host:2883/mtm-online?charset=utf8mb4
      或拆开写：
      SCM_MYSQL_HOST / SCM_MYSQL_PORT / SCM_MYSQL_USER / SCM_MYSQL_PASSWORD / SCM_MYSQL_DB

★ 结构差异只影响两处（见 models.py / migrations.py）：
  1. MySQL 没有「部分唯一索引」，两个 sqlite_where 索引在 MySQL 侧换成生成列 + 唯一键；
  2. migrations.py 里全是 SQLite 专用语法（PRAGMA / sqlite_master），MySQL 下整段跳过，
     由 docs/mysql/schema.sql 或 create_all 负责建表。
"""

import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import URL, Engine, make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker


def _mysql_url_from_parts() -> URL:
    """由 SCM_MYSQL_* 组装连接 URL。

    ★ 不要拼字符串再做 URL 编码：密码里的 @ # / ? : % + 空格 会在「编码 → 反解析」
      过程中走样（`quote_plus` 把空格编成 `+`，反解析回来变不回空格），
      这正是「密码有特殊字符就 401/1045」的根因。
      改用 URL.create() 直接传原值，编码交给 SQLAlchemy，密码一个字节都不动。
    """
    user = os.environ.get("SCM_MYSQL_USER") or None
    password = os.environ.get("SCM_MYSQL_PASSWORD") or None
    host = os.environ.get("SCM_MYSQL_HOST") or None
    db = os.environ.get("SCM_MYSQL_DB") or "mtm-online"

    raw_port = (os.environ.get("SCM_MYSQL_PORT") or "").strip()
    try:
        port = int(raw_port) if raw_port else 2883
    except ValueError:
        raise RuntimeError(f"SCM_MYSQL_PORT 不是数字：{raw_port!r}") from None

    return URL.create(
        drivername="mysql+pymysql",
        username=user,
        password=password,
        host=host,
        port=port,
        database=db,
        query={"charset": "utf8mb4", "connect_timeout": "10"},
    )


def _check_raw_dsn(raw: str) -> None:
    """整串 DSN 的护栏：密码里的 @ 会让密码被截断（`p@ss` 解析成 `p`），必须提前拦。

    SQLAlchemy 解析 `scheme://user:pass@host` 时以 **最后一个 @** 分隔认证段与主机段，
    密码中间再出现 @ 不会报错，只会静默把密码截短 —— 然后数据库回 1045，当事人以为是密码错。
    """
    _, sep, rest = raw.partition("://")
    if not sep:
        raise RuntimeError(f"SCM_DB_URL 不是合法 URL：{raw[:32]}…")
    authority = rest.split("/", 1)[0].split("?", 1)[0]
    if authority.count("@") > 1:
        raise RuntimeError(
            "SCM_DB_URL 的认证段里出现多个 @，密码含 @ 会被截断成 @ 之前的部分。"
            "改成 SCM_MYSQL_HOST/PORT/USER/PASSWORD/DB 五个变量（推荐），"
            "或把密码里的 @ 写成 %40。"
        )


def _resolve_database_url() -> tuple[str | URL, str]:
    """返回 (连接地址, 模式)。模式：url / parts / sqlite。"""
    explicit = (os.environ.get("SCM_DB_URL") or "").strip()
    if explicit:
        _check_raw_dsn(explicit)
        try:
            return make_url(explicit), "url"
        except Exception as exc:  # 典型：密码里有未编码的 / 或 #
            raise RuntimeError(
                "SCM_DB_URL 解析失败（多半是密码里有特殊字符未编码）。"
                "请改用 SCM_MYSQL_HOST/PORT/USER/PASSWORD/DB 五个变量，那套不做字符串拼接。"
                f" 原始错误：{exc}"
            ) from exc

    if (os.environ.get("SCM_MYSQL_HOST") or "").strip():
        return _mysql_url_from_parts(), "parts"
    return "", "sqlite"


DATABASE_URL, DB_MODE = _resolve_database_url()
IS_MYSQL = DB_MODE in ("url", "parts") and str(
    getattr(DATABASE_URL, "drivername", DATABASE_URL) or ""
).startswith(("mysql", "mariadb"))

# SQLite 数据库文件路径：始终定位到 backend/products.db，不依赖进程 cwd
# 这样无论从项目根目录还是 backend/ 启动 uvicorn，都使用同一份数据。
# 容器部署可用 SCM_DB_PATH 指到挂载卷（如 /data/products.db），实现数据持久化。
DB_PATH = Path(
    os.environ.get("SCM_DB_PATH")
    or (Path(__file__).resolve().parent.parent / "products.db")
)
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
if not DATABASE_URL:
    DATABASE_URL = f"sqlite:///{DB_PATH.as_posix()}"


if IS_MYSQL:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,   # 断线自动重连（OB / 负载均衡会掐空闲连接）
        pool_recycle=1800,    # 30 分钟回收，配合 pre_ping 更稳
        future=True,
        echo=False,
    )
else:
    engine = create_engine(
        DATABASE_URL,
        # SQLite 在跨线程使用连接时需要关闭该检查（FastAPI 依赖注入场景）
        connect_args={"check_same_thread": False},
        echo=False,
    )


@event.listens_for(Engine, "connect")
def _on_connect(dbapi_conn, _connection_record) -> None:
    """SQLite：每条连接开启外键约束。

    SQLite 默认 PRAGMA foreign_keys=OFF，models 里所有 ondelete="CASCADE" 都只是注释，
    删除父行不会被约束拦住、也不会级联 —— 会静默留下孤儿行（孤儿行的 id 被 rowid 复用后
    还能让「新建项目」继承旧档案）。开启后由数据库保证引用完整性。

    MySQL / OceanBase：InnoDB 自带外键强制，不需要额外动作。
    """
    if IS_MYSQL:
        return
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""


def get_db():
    """FastAPI 依赖：为每个请求提供独立的数据库会话。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
