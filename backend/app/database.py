"""数据库引擎与会话管理（SQLite 本地开发）。"""

from pathlib import Path

from sqlalchemy import create_engine
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
