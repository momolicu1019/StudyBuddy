from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Subject(BaseModel):
    id: int
    name: str
    icon: str
    cards: int = 0
    mastered: int = 0
    last: str = "Not studied yet"


class SubjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    icon: str = "📚"


class SubjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    icon: str | None = None


class Flashcard(BaseModel):
    id: int
    question: str
    answer: str
    mastered: bool = False


class FlashcardCreate(BaseModel):
    question: str
    answer: str


class GenerateRequest(BaseModel):
    subject_id: int
    source_type: Literal["pdf", "photo"]
    filename: str = "notes"


class GenerateResponse(BaseModel):
    count: int
    subject: Subject
    sample_question: str
    sample_answer: str
    message: str


class QuizQuestion(BaseModel):
    id: int
    question: str
    options: list[str]
    correct_index: int


class QuizSubmit(BaseModel):
    subject_id: int
    answers: dict[int, int]


class QuizResult(BaseModel):
    score: int
    total: int
    percentage: int
    message: str


class TutorMessage(BaseModel):
    message: str
    subject: str | None = None


class TutorReply(BaseModel):
    reply: str


class Stats(BaseModel):
    flashcards_reviewed: int
    quiz_average: int
    focus_hours: float


class FocusSession(BaseModel):
    minutes: int = 25
