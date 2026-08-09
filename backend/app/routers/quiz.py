from __future__ import annotations

import random

from fastapi import APIRouter, HTTPException

from app.database import load_data, save_data
from app.schemas import (
    QuizQuestion,
    QuizQuestionReview,
    QuizResult,
    QuizSubmit,
)

router = APIRouter()

FALLBACK_DISTRACTORS = [
    "Not enough information",
    "All of the above",
    "None of the above",
    "It depends on context",
    "This statement is false",
    "Cannot be determined from the notes",
]

QUIZ_SIZE = 20


def _normalize_ids(subject_id: int | list[int]) -> list[int]:
    return subject_id if isinstance(subject_id, list) else [subject_id]


def _build_options(correct: str, pool: list[str]) -> tuple[list[str], int]:
    distractors: list[str] = []
    seen = {correct.strip().lower()}
    shuffled_pool = list(pool)
    random.shuffle(shuffled_pool)
    for answer in [*shuffled_pool, *FALLBACK_DISTRACTORS]:
        key = answer.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        distractors.append(answer.strip())
        if len(distractors) == 3:
            break
    while len(distractors) < 3:
        distractors.append(f"Option {chr(65 + len(distractors))}")
    options = [correct, *distractors]
    random.shuffle(options)
    return options, options.index(correct)


@router.get("/{subject_id}", response_model=list[QuizQuestion])
def get_quiz(subject_id: int) -> list[QuizQuestion]:
    data = load_data()
    subject = next((s for s in data["subjects"] if s["id"] == subject_id), None)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    cards = list(data["flashcards"].get(str(subject_id), []))
    if not cards:
        return []

    random.shuffle(cards)
    selected = cards[: min(QUIZ_SIZE, len(cards))]
    pool_answers = [c["answer"] for c in cards]
    questions: list[QuizQuestion] = []
    for card in selected:
        options, correct_index = _build_options(card["answer"], pool_answers)
        questions.append(
            QuizQuestion(
                id=card["id"],
                question=card["question"],
                options=options,
                correct_index=correct_index,
            )
        )
    return questions


@router.post("/submit", response_model=QuizResult)
def submit_quiz(payload: QuizSubmit) -> QuizResult:
    data = load_data()
    ids = _normalize_ids(payload.subject_id)
    subjects = [s for s in data["subjects"] if s["id"] in ids]
    if not subjects:
        raise HTTPException(status_code=404, detail="Subject not found")
    if not payload.questions:
        raise HTTPException(status_code=400, detail="No quiz questions to grade")

    reviews: list[QuizQuestionReview] = []
    score = 0
    for question in payload.questions:
        selected = payload.answers.get(question.id)
        is_correct = selected is not None and selected == question.correct_index
        if is_correct:
            score += 1
            for sid in ids:
                for card in data["flashcards"].get(str(sid), []):
                    if card["id"] == question.id:
                        card["mastered"] = True
        reviews.append(
            QuizQuestionReview(
                id=question.id,
                question=question.question,
                options=question.options,
                selected_index=selected,
                correct_index=question.correct_index,
                is_correct=is_correct,
                correct_answer=question.options[question.correct_index],
                selected_answer=(
                    None if selected is None else question.options[selected]
                ),
            )
        )

    total = len(reviews)
    percentage = round((score / total) * 100) if total else 0

    for subject in subjects:
        cards = data["flashcards"].get(str(subject["id"]), [])
        subject["mastered"] = sum(1 for c in cards if c.get("mastered"))
        subject["cards"] = len(cards)
        subject["last"] = "Just now"

    taken = data["stats"].get("quizzes_taken", 0)
    prev = data["stats"].get("quiz_average", 0)
    if taken == 0:
        data["stats"]["quiz_average"] = percentage
    else:
        data["stats"]["quiz_average"] = round((prev + percentage) / 2)
    data["stats"]["quizzes_taken"] = taken + 1
    save_data(data)

    if percentage >= 80:
        message = "Great work — you're mastering this subject!"
    elif percentage >= 50:
        message = "Solid effort. Review the missed cards and try again."
    else:
        message = "Keep going! Study the flashcards, then retake the quiz."

    return QuizResult(
        score=score,
        total=total,
        percentage=percentage,
        message=message,
        reviews=reviews,
    )
