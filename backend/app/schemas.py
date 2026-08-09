from __future__ import annotations

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


class DraftFlashcard(BaseModel):
    question: str
    answer: str


class Stats(BaseModel):
    flashcards_reviewed: int
    quiz_average: int
    focus_hours: float


class FlashcardReview(BaseModel):
    mastered: bool


class ReviewResponse(BaseModel):
    flashcard: Flashcard
    subject: Subject
    stats: Stats


class GenerateDraftResponse(BaseModel):
    count: int
    cards: list[DraftFlashcard]
    sample_question: str
    sample_answer: str
    message: str
    filename: str
    source_type: str


class SaveFlashcardsRequest(BaseModel):
    subject_id: int
    cards: list[DraftFlashcard] = Field(min_length=1)


class SaveFlashcardsResponse(BaseModel):
    count: int
    subject: Subject
    message: str


class QuizQuestion(BaseModel):
    id: int
    question: str
    options: list[str]
    correct_index: int


class QuizSubmit(BaseModel):
    subject_id: int | list[int]
    answers: dict[int, int]
    questions: list[QuizQuestion] = Field(default_factory=list)


class QuizQuestionReview(BaseModel):
    id: int
    question: str
    options: list[str]
    selected_index: int | None = None
    correct_index: int
    is_correct: bool
    correct_answer: str
    selected_answer: str | None = None


class QuizResult(BaseModel):
    score: int
    total: int
    percentage: int
    message: str
    reviews: list[QuizQuestionReview] = Field(default_factory=list)


class TutorMessage(BaseModel):
    message: str
    subject: str | None = None


class TutorReply(BaseModel):
    reply: str


class FocusSession(BaseModel):
    minutes: int = 25
