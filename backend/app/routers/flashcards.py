from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.card_counts import estimate_card_count
from app.database import load_data, save_data
from app.schemas import (
    DraftFlashcard,
    Flashcard,
    FlashcardCreate,
    FlashcardReview,
    GenerateDraftResponse,
    ReviewResponse,
    SaveFlashcardsRequest,
    SaveFlashcardsResponse,
    Stats,
)

router = APIRouter()


def _recount_mastered(cards: list[dict]) -> int:
    return sum(1 for card in cards if card.get("mastered"))


def _public_stats(data: dict) -> Stats:
    stats = data["stats"]
    return Stats(
        flashcards_reviewed=stats.get("flashcards_reviewed", 0),
        quiz_average=stats.get("quiz_average", 0),
        focus_hours=stats.get("focus_hours", 0.0),
    )


def _build_draft_cards(
    source_type: str,
    filename: str,
    *,
    file_bytes: bytes | None = None,
) -> list[DraftFlashcard]:
    stem = Path(filename).stem.replace("_", " ").replace("-", " ").strip() or "your notes"
    count = estimate_card_count(source_type, file_bytes, filename=filename)
    return [
        DraftFlashcard(
            question=f"What is key point #{i + 1} from {stem}?",
            answer=(
                f"Summarize point #{i + 1} from your {source_type} notes "
                f"in “{stem}” using your own words."
            ),
        )
        for i in range(count)
    ]


@router.post("/generate", response_model=GenerateDraftResponse)
async def generate_flashcards(
    source_type: str = Form(...),
    filename: str = Form("notes"),
    file: UploadFile | None = File(None),
) -> GenerateDraftResponse:
    """Turn an uploaded PDF/photo into draft flashcards (not saved yet)."""
    if source_type not in {"pdf", "photo"}:
        raise HTTPException(status_code=422, detail="source_type must be pdf or photo")

    file_bytes: bytes | None = None
    if file is not None:
        file_bytes = await file.read()
        if file.filename:
            filename = file.filename

    cards = _build_draft_cards(source_type, filename, file_bytes=file_bytes)
    sample = cards[0]
    return GenerateDraftResponse(
        count=len(cards),
        cards=cards,
        sample_question=sample.question,
        sample_answer=sample.answer,
        message=(
            f'{len(cards)} flashcards were generated from "{filename}". '
            "Choose a folder to save them."
        ),
        filename=filename,
        source_type=source_type,
    )


@router.post("/save", response_model=SaveFlashcardsResponse)
def save_flashcards(payload: SaveFlashcardsRequest) -> SaveFlashcardsResponse:
    """Persist draft flashcards into a subject folder."""
    data = load_data()
    subject = next((s for s in data["subjects"] if s["id"] == payload.subject_id), None)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    key = str(subject["id"])
    data["flashcards"].setdefault(key, [])

    for draft in payload.cards:
        data["flashcards"][key].append(
            {
                "id": data["next_card_id"],
                "question": draft.question,
                "answer": draft.answer,
                "mastered": False,
            }
        )
        data["next_card_id"] += 1

    subject["cards"] = len(data["flashcards"][key])
    subject["mastered"] = _recount_mastered(data["flashcards"][key])
    subject["last"] = "Just now"
    save_data(data)

    count = len(payload.cards)
    return SaveFlashcardsResponse(
        count=count,
        subject=subject,
        message=(
            f'{count} flashcards were saved to {subject["icon"]} {subject["name"]}.'
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
    subject["cards"] = len(data["flashcards"][str(subject_id)])
    subject["mastered"] = _recount_mastered(data["flashcards"][str(subject_id)])
    subject["last"] = "Just now"
    save_data(data)
    return card


@router.post(
    "/{subject_id}/cards/{card_id}/review",
    response_model=ReviewResponse,
)
def review_flashcard(
    subject_id: int,
    card_id: int,
    payload: FlashcardReview,
) -> ReviewResponse:
    data = load_data()
    subject = next((s for s in data["subjects"] if s["id"] == subject_id), None)
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    cards = data["flashcards"].get(str(subject_id), [])
    card = next((c for c in cards if c["id"] == card_id), None)
    if not card:
        raise HTTPException(status_code=404, detail="Flashcard not found")

    card["mastered"] = payload.mastered
    subject["cards"] = len(cards)
    subject["mastered"] = _recount_mastered(cards)
    subject["last"] = "Just now"
    data["stats"]["flashcards_reviewed"] = data["stats"].get("flashcards_reviewed", 0) + 1
    save_data(data)

    return ReviewResponse(
        flashcard=card,
        subject=subject,
        stats=_public_stats(data),
    )
