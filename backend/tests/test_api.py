from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.database import DEFAULT_DATA, save_data
from app.main import app


@pytest.fixture(autouse=True)
def fresh_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = tmp_path / "studybuddy.json"
    from app import database

    monkeypatch.setattr(database, "DB_PATH", db_file)
    save_data(json.loads(json.dumps(DEFAULT_DATA)))
    yield


@pytest.fixture
def client():
    return TestClient(app)


def test_health(client: TestClient):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_starts_empty(client: TestClient):
    subjects = client.get("/api/subjects")
    assert subjects.status_code == 200
    assert subjects.json() == []

    stats = client.get("/api/stats")
    assert stats.status_code == 200
    assert stats.json() == {
        "flashcards_reviewed": 0,
        "quiz_average": 0,
        "focus_hours": 0.0,
    }


def test_list_and_create_subjects(client: TestClient):
    res = client.get("/api/subjects")
    assert res.status_code == 200
    assert len(res.json()) == 0

    created = client.post("/api/subjects", json={"name": "Biology", "icon": "🧬"})
    assert created.status_code == 201
    body = created.json()
    assert body["name"] == "Biology"
    assert body["cards"] == 0
    assert body["mastered"] == 0

    listed = client.get("/api/subjects", params={"q": "bio"})
    assert len(listed.json()) == 1


def test_generate_then_save_and_review(client: TestClient):
    # Generate does not require a folder and does not persist cards yet.
    draft = client.post(
        "/api/flashcards/generate",
        data={"source_type": "pdf", "filename": "algebra.pdf"},
    )
    assert draft.status_code == 200
    body = draft.json()
    assert body["count"] == 12
    assert len(body["cards"]) == 12
    assert client.get("/api/subjects").json() == []

    subject = client.post("/api/subjects", json={"name": "Algebra", "icon": "➗"}).json()
    saved = client.post(
        "/api/flashcards/save",
        json={"subject_id": subject["id"], "cards": body["cards"]},
    )
    assert saved.status_code == 200
    assert saved.json()["subject"]["cards"] == 12
    assert saved.json()["subject"]["mastered"] == 0

    cards = client.get(f"/api/flashcards/{subject['id']}").json()
    assert len(cards) == 12

    review = client.post(
        f"/api/flashcards/{subject['id']}/cards/{cards[0]['id']}/review",
        json={"mastered": True},
    )
    assert review.status_code == 200
    reviewed = review.json()
    assert reviewed["flashcard"]["mastered"] is True
    assert reviewed["subject"]["mastered"] == 1
    assert reviewed["stats"]["flashcards_reviewed"] == 1


def test_quiz_requires_saved_cards(client: TestClient):
    subject = client.post("/api/subjects", json={"name": "History", "icon": "🌎"}).json()
    quiz = client.get(f"/api/quiz/{subject['id']}")
    assert quiz.status_code == 200
    assert quiz.json() == []

    draft = client.post(
        "/api/flashcards/generate",
        data={"source_type": "photo", "filename": "notes.jpg"},
    ).json()
    client.post(
        "/api/flashcards/save",
        json={"subject_id": subject["id"], "cards": draft["cards"]},
    )

    quiz = client.get(f"/api/quiz/{subject['id']}")
    questions = quiz.json()
    assert len(questions) == 8

    answers = {q["id"]: 0 for q in questions}
    result = client.post(
        "/api/quiz/submit",
        json={"subject_id": subject["id"], "answers": answers},
    )
    assert result.status_code == 200
    assert result.json()["percentage"] == 100

    stats = client.get("/api/stats").json()
    assert stats["quiz_average"] == 100


def test_tutor_and_stats(client: TestClient):
    tutor = client.post(
        "/api/tutor/ask",
        json={"message": "Explain photosynthesis", "subject": "Science"},
    )
    assert tutor.status_code == 200
    assert "break" in tutor.json()["reply"].lower() or "study" in tutor.json()["reply"].lower()

    stats = client.get("/api/stats")
    assert stats.status_code == 200
    before = stats.json()["focus_hours"]

    focus = client.post("/api/stats/focus", json={"minutes": 25})
    assert focus.status_code == 200
    assert focus.json()["focus_hours"] > before
