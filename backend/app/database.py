from __future__ import annotations

import json
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "studybuddy.json"

# Fresh installs start empty — subjects and cards appear only after the student
# creates folders and uploads notes.
DEFAULT_DATA = {
    "subjects": [],
    "flashcards": {},
    "stats": {
        "flashcards_reviewed": 0,
        "quiz_average": 0,
        "focus_hours": 0.0,
        "quizzes_taken": 0,
    },
    "next_subject_id": 1,
    "next_card_id": 1,
}


def ensure_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not DB_PATH.exists():
        save_data(json.loads(json.dumps(DEFAULT_DATA)))


def load_data() -> dict:
    ensure_db()
    with DB_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    # Backfill newer stats keys for older local DB files.
    stats = data.setdefault("stats", {})
    stats.setdefault("flashcards_reviewed", 0)
    stats.setdefault("quiz_average", 0)
    stats.setdefault("focus_hours", 0.0)
    stats.setdefault("quizzes_taken", 0)
    data.setdefault("subjects", [])
    data.setdefault("flashcards", {})
    data.setdefault("next_subject_id", 1)
    data.setdefault("next_card_id", 1)
    return data


def save_data(data: dict) -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with DB_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def reset_db() -> None:
    """Overwrite the on-disk store with empty defaults (dev/testing helper)."""
    save_data(json.loads(json.dumps(DEFAULT_DATA)))
