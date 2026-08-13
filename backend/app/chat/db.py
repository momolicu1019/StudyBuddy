from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.chat.config import get_database_url, is_sqlite
from app.chat.models import Base

_url = get_database_url()
_connect_args: dict = {}
_engine_kwargs: dict = {
    "echo": False,
    "pool_pre_ping": True,
}

if is_sqlite():
    _connect_args = {"check_same_thread": False}
    # Keep a single shared :memory: DB across connections (tests + local).
    if ":memory:" in _url:
        _engine_kwargs["poolclass"] = StaticPool
elif _url.startswith("postgresql"):
    # Neon requires TLS.
    _connect_args = {"ssl": True}

engine = create_async_engine(_url, connect_args=_connect_args, **_engine_kwargs)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

_initialized = False


async def init_chat_db() -> None:
    global _initialized
    if _initialized:
        return
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    _initialized = True


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    await init_chat_db()
    async with SessionLocal() as session:
        yield session
