from __future__ import annotations

import json
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "studybuddy.json"

DEFAULT_DATA = {
    "subjects": [
        {
            "id": 1,
            "name": "Mathematics",
            "icon": "➗",
            "cards": 32,
            "mastered": 24,
            "last": "Today",
        },
        {
            "id": 2,
            "name": "Science",
            "icon": "🔬",
            "cards": 48,
            "mastered": 36,
            "last": "Yesterday",
        },
        {
            "id": 3,
            "name": "English",
            "icon": "📖",
            "cards": 21,
            "mastered": 15,
            "last": "2 days ago",
        },
        {
            "id": 4,
            "name": "History",
            "icon": "🌎",
            "cards": 27,
            "mastered": 18,
            "last": "Friday",
        },
    ],
    "flashcards": {
        "1": [
            {
                "id": 101,
                "question": "What is the Pythagorean theorem?",
                "answer": "a² + b² = c² for a right triangle.",
                "mastered": True,
            },
            {
                "id": 102,
                "question": "What is the derivative of x²?",
                "answer": "2x",
                "mastered": False,
            },
        ],
        "2": [
            {
                "id": 201,
                "question": "What is photosynthesis?",
                "answer": "Process by which plants convert light into chemical energy.",
                "mastered": True,
            },
            {
                "id": 202,
                "question": "What is the powerhouse of the cell?",
                "answer": "Mitochondria",
                "mastered": False,
            },
        ],
        "3": [
            {
                "id": 301,
                "question": "What is a metaphor?",
                "answer": "A figure of speech comparing two unlike things without using like or as.",
                "mastered": True,
            }
        ],
        "4": [
            {
                "id": 401,
                "question": "When did World War II end?",
                "answer": "1945",
                "mastered": False,
            }
        ],
    },
    "stats": {
        "flashcards_reviewed": 128,
        "quiz_average": 82,
        "focus_hours": 4.5,
    },
    "next_subject_id": 5,
    "next_card_id": 500,
}


def ensure_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not DB_PATH.exists():
        save_data(DEFAULT_DATA.copy())


def load_data() -> dict:
    ensure_db()
    with DB_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_data(data: dict) -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with DB_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
