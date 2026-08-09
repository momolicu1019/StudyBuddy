from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.database import load_data, save_data
from app.schemas import Flashcard, FlashcardCreate, GenerateRequest, GenerateResponse

router = APIRouter()


@router.post("/generate", response_model=GenerateResponse)
def generate_flashcards(payload: GenerateRequest) -> GenerateResponse:
    data = load_data()
    subject = next((s for s in data["subjects"] if s["id"] == payload.subject_id), None)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    count = 12 if payload.source_type == "photo" else 24
    key = str(subject["id"])
    data["flashcards"].setdefault(key, [])

    for i in range(count):
        card = {
            "id": data["next_card_id"],
            "question": f"Key concept #{i + 1} from {payload.filename}?",
            "answer": f"AI-extracted answer based on your {payload.source_type} notes.",
            "mastered": False,
        }
        data["next_card_id"] += 1
        data["flashcards"][key].append(card)

    subject["cards"] += count
    subject["mastered"] = min(subject["cards"], subject["mastered"] + max(1, count // 5))
    subject["last"] = "Just now"
    data["stats"]["flashcards_reviewed"] += count
    save_data(data)

    return GenerateResponse(
        count=count,
        subject=subject,
        sample_question="What is one key concept from the uploaded notes?",
        sample_answer="The AI-generated answer will be based on the content of your PDF or note photo.",
        message=(
            f'{count} new flashcards were created from "{payload.filename}" '
            f'and saved to {subject["icon"]} {subject["name"]}.'
        ),
    )


@router.get("/{subject_id}", response_model=list[Flashcard])
def list_flashcards(subject_id: int) -> list[Flashcard]:
    data = load_data()
    if not any(s["id"] == subject_id for s in data["subjects"]):
        raise HTTPException(status_code=404, detail="Subject not found")
    return data["flashcards"].get(str(subject_id), [])


@router.post("/{subject_id}", response_model=Flashcard, status_code=201)
def create_flashcard(subject_id: int, payload: FlashcardCreate) -> Flashcard:
    data = load_data()
    subject = next((s for s in data["subjects"] if s["id"] == subject_id), None)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    card = {
        "id": data["next_card_id"],
        "question": payload.question,
        "answer": payload.answer,
        "mastered": False,
    }
    data["next_card_id"] += 1
    data["flashcards"].setdefault(str(subject_id), []).append(card)
    subject["cards"] += 1
    subject["last"] = "Just now"
    save_data(data)
    return card
