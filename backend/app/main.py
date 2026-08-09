from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import ensure_db
from app.routers import flashcards, quiz, stats, subjects, tutor

ensure_db()

app = FastAPI(
    title="StudyBuddy AI API",
    description="Backend for the StudyBuddy AI mobile app",
    version="1.0.0",
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


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": "StudyBuddy AI"}
