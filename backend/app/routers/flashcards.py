from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.card_counts import estimate_card_count, is_situational_material
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

# Domain-matched study examples for cloud draft cards.
_GENERAL_EXAMPLES = [
    "If a plant sits in sunlight, sugar builds up in the leaves while oxygen is released.",
    "For a right triangle with legs 3 and 4, the hypotenuse is 5 because 3² + 4² = 5².",
    "Water freezing at 0°C is a physical change — the formula stays H₂O.",
    "In 2x + 6 = 14, subtract 6 then divide by 2 to get x = 4.",
    "A cell with damaged mitochondria makes far less ATP and tires quickly.",
    "Pushing a stalled car uses Newton’s second law: more force → more acceleration.",
    "Evaporation after rain cools skin because liquid water absorbs heat to become vapor.",
    "If ice melts in a closed bottle, mass stays the same even though the state changes.",
]

_SITUATIONAL_EXAMPLES = [
    "If a landlord enters a rented apartment without notice, the tenant may claim breach of quiet enjoyment.",
    "When a shopper slips on an unmarked wet floor, the store may be liable under premises negligence.",
    "If A offers to sell a bike for $100 and B says “I accept,” a binding contract can form.",
    "When police question a suspect in custody without Miranda warnings, statements may be suppressed.",
    "If a driver runs a red light and hits a pedestrian, duty and breach support a negligence claim.",
    "When an employee is fired for reporting illegal conduct, whistleblower protections may apply.",
    "If a roommate keeps a deposit after no damage is found, the departing tenant can seek return of the funds.",
    "When a company uses a customer’s photo in an ad without consent, a privacy or publicity claim may arise.",
]


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
    situational = is_situational_material(stem, filename, source_type)
    examples = _SITUATIONAL_EXAMPLES if situational else _GENERAL_EXAMPLES
    cards: list[DraftFlashcard] = []
    for i in range(count):
        example = examples[i % len(examples)]
        how_it_works = (
            "connect this rule to parties, duties, rights, or defenses in the material."
            if situational
            else "connect this idea to the surrounding steps or facts in the material."
        )
        cards.append(
            DraftFlashcard(
                question=f"Key idea {i + 1} from {stem}",
                answer=(
                    f"• Definition: core point #{i + 1} from your {source_type} notes in “{stem}”.\n"
                    f"• How it works: {how_it_works}\n"
                    f"• Example: {example}\n"
                    f"• Why it matters: this is a likely exam target from “{stem}”."
                ),
            )
        )
    return cards


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
