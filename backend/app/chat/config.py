from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


@lru_cache
def get_database_url() -> str:
    raw = (os.getenv("DATABASE_URL") or "").strip()
    if not raw:
        # Local/tests default — no Neon required for pytest.
        return "sqlite+aiosqlite:///:memory:"
    if raw.startswith("postgres://"):
        raw = "postgresql://" + raw[len("postgres://") :]
    if raw.startswith("postgresql://") and "+asyncpg" not in raw:
        raw = "postgresql+asyncpg://" + raw[len("postgresql://") :]
    # asyncpg does not accept libpq sslmode in the URL the same way.
    if "sslmode=" in raw:
        raw = raw.replace("?sslmode=require", "").replace("&sslmode=require", "")
        raw = raw.replace("?sslmode=prefer", "").replace("&sslmode=prefer", "")
    return raw


@lru_cache
def get_jwt_secret() -> str:
    return (os.getenv("CHAT_JWT_SECRET") or "dev-studybuddy-chat-secret").strip()


@lru_cache
def get_jwt_hours() -> int:
    try:
        return max(1, int(os.getenv("CHAT_JWT_HOURS") or "720"))
    except ValueError:
        return 720


def is_sqlite() -> bool:
    return get_database_url().startswith("sqlite")
