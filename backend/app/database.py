"""数据库引擎与会话管理（SQLite 本地开发）。"""

from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# SQLite 数据库文件路径：始终定位到 backend/products.db，不依赖进程 cwd
# 这样无论从项目根目录还是 backend/ 启动 uvicorn，都使用同一份数据
DB_PATH = Path(__file__).resolve().parent.parent / "products.db"
DATABASE_URL = f"sqlite:///{DB_PATH.as_posix()}"

engine = create_engine(
    DATABASE_URL,
    # SQLite 在跨线程使用连接时需要关闭该检查（FastAPI 依赖注入场景）
    connect_args={"check_same_thread": False},
    echo=False,
)


@event.listens_for(Engine, "connect")
def _set_sqlite_pragma(dbapi_conn, _connection_record) -> None:
    """每条连接开启外键约束。

    SQLite 默认 PRAGMA foreign_keys=OFF，models 里所有 ondelete="CASCADE" 都只是注释，
    删除父行不会被约束拦住、也不会级联 —— 会静默留下孤儿行（孤儿行的 id 被 rowid 复用后
    还能让「新建项目」继承旧档案）。开启后由数据库保证引用完整性。
    """
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
