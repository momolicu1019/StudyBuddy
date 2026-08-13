from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.chat.db import init_chat_db
from app.chat.router import router as chat_router
from app.database import ensure_db
from app.routers import flashcards, quiz, stats, subjects, tutor

ensure_db()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_chat_db()
    yield


app = FastAPI(
    title="StudyBuddy AI API",
    description="Backend for the StudyBuddy AI mobile app",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(subjects.router, prefix="/api/subjects", tags=["subjects"])
app.include_router(flashcards.router, prefix="/api/flashcards", tags=["flashcards"])
app.include_router(quiz.router, prefix="/api/quiz", tags=["quiz"])
app.include_router(tutor.router, prefix="/api/tutor", tags=["tutor"])
app.include_router(stats.router, prefix="/api/stats", tags=["stats"])
app.include_router(chat_router, prefix="/api/chat", tags=["chat"])


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": "StudyBuddy AI"}
