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
        # Fallback demo questions when deck is empty
        return [
            QuizQuestion(
                id=1,
                question=f"Ready to start a {subject['name']} quiz?",
                options=["Yes, let's go!", "Maybe later", "I need more cards", "Ask AI Tutor"],
                correct_index=0,
            )
        ]

    questions: list[QuizQuestion] = []
    for index, card in enumerate(cards[:8]):
        options = [card["answer"], *DISTRACTORS[:3]]
        questions.append(
            QuizQuestion(
                id=card["id"],
                question=card["question"],
                options=options,
                correct_index=0,
            )
        )
        # Rotate distractors so options feel varied
        DISTRACTORS.append(DISTRACTORS.pop(0))
        _ = index
    return questions


@router.post("/submit", response_model=QuizResult)
def submit_quiz(payload: QuizSubmit) -> QuizResult:
    data = load_data()
    subject = next((s for s in data["subjects"] if s["id"] == payload.subject_id), None)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    cards = {c["id"]: c for c in data["flashcards"].get(str(payload.subject_id), [])}
    total = max(len(payload.answers), 1)
    score = 0

    for card_id, answer_index in payload.answers.items():
        # Generated quizzes always put the correct answer at index 0
        if answer_index == 0:
            score += 1
            card = cards.get(int(card_id))
            if card and not card.get("mastered"):
                card["mastered"] = True
                subject["mastered"] = min(subject["cards"], subject["mastered"] + 1)

    percentage = round((score / total) * 100)
    subject["last"] = "Just now"
    # Blend into rolling average
    prev = data["stats"]["quiz_average"]
    data["stats"]["quiz_average"] = round((prev + percentage) / 2)
    save_data(data)

    if percentage >= 80:
        message = "Great work — you're mastering this subject!"
    elif percentage >= 50:
        message = "Solid effort. Review the missed cards and try again."
    else:
        message = "Keep going! Study the flashcards, then retake the quiz."

    return QuizResult(score=score, total=total, percentage=percentage, message=message)
