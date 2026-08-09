from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.database import load_data, save_data
from app.schemas import QuizQuestion, QuizResult, QuizSubmit

router = APIRouter()

DISTRACTORS = [
    "Not enough information",
    "All of the above",
    "None of the above",
    "It depends on context",
]


@router.get("/{subject_id}", response_model=list[QuizQuestion])
def get_quiz(subject_id: int) -> list[QuizQuestion]:
    data = load_data()
    subject = next((s for s in data["subjects"] if s["id"] == subject_id), None)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    cards = data["flashcards"].get(str(subject_id), [])
    if not cards:
        return []

    distractors = list(DISTRACTORS)
    questions: list[QuizQuestion] = []
    for card in cards[:8]:
        options = [card["answer"], *distractors[:3]]
        questions.append(
            QuizQuestion(
                id=card["id"],
                question=card["question"],
                options=options,
                correct_index=0,
            )
        )
        distractors.append(distractors.pop(0))
    return questions


@router.post("/submit", response_model=QuizResult)
def submit_quiz(payload: QuizSubmit) -> QuizResult:
    data = load_data()
    subject = next((s for s in data["subjects"] if s["id"] == payload.subject_id), None)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    cards = {c["id"]: c for c in data["flashcards"].get(str(payload.subject_id), [])}
    if not cards or not payload.answers:
        raise HTTPException(status_code=400, detail="No quiz answers to grade")

    total = len(payload.answers)
    score = 0

    for card_id, answer_index in payload.answers.items():
        # Generated quizzes always put the correct answer at index 0
        if answer_index == 0:
            score += 1
            card = cards.get(int(card_id))
            if card and not card.get("mastered"):
                card["mastered"] = True

    subject["mastered"] = sum(
        1 for c in data["flashcards"].get(str(payload.subject_id), []) if c.get("mastered")
    )
    subject["cards"] = len(data["flashcards"].get(str(payload.subject_id), []))
    subject["last"] = "Just now"

    percentage = round((score / total) * 100)
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

    return QuizResult(score=score, total=total, percentage=percentage, message=message)
