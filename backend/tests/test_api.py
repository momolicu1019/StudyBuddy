from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.database import DB_PATH, DEFAULT_DATA, save_data
from app.main import app


@pytest.fixture(autouse=True)
def fresh_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    db_file = tmp_path / "studybuddy.json"
    monkeypatch.setattr("app.database.DB_PATH", db_file)
    monkeypatch.setattr("app.routers.subjects.DB_PATH", db_file, raising=False)
    # Ensure routers use load/save which read from patched path via import
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


def test_list_and_create_subjects(client: TestClient):
    res = client.get("/api/subjects")
    assert res.status_code == 200
    assert len(res.json()) == 4

    created = client.post("/api/subjects", json={"name": "Biology", "icon": "🧬"})
    assert created.status_code == 201
    assert created.json()["name"] == "Biology"

    listed = client.get("/api/subjects", params={"q": "bio"})
    assert len(listed.json()) == 1


def test_generate_flashcards(client: TestClient):
    res = client.post(
        "/api/flashcards/generate",
        json={"subject_id": 1, "source_type": "pdf", "filename": "algebra.pdf"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["count"] == 24
    assert body["subject"]["cards"] >= 24


def test_quiz_flow(client: TestClient):
    quiz = client.get("/api/quiz/1")
    assert quiz.status_code == 200
    questions = quiz.json()
    assert questions

    answers = {str(q["id"]): 0 for q in questions}
    # API expects dict[int, int] but JSON keys are strings — FastAPI coerces
    result = client.post(
        "/api/quiz/submit",
        json={"subject_id": 1, "answers": {int(k): v for k, v in answers.items()}},
    )
    assert result.status_code == 200
    assert result.json()["percentage"] == 100


def test_tutor_and_stats(client: TestClient):
    tutor = client.post("/api/tutor/ask", json={"message": "Explain photosynthesis", "subject": "Science"})
    assert tutor.status_code == 200
    assert "break" in tutor.json()["reply"].lower() or "study" in tutor.json()["reply"].lower()

    stats = client.get("/api/stats")
    assert stats.status_code == 200
    before = stats.json()["focus_hours"]

    focus = client.post("/api/stats/focus", json={"minutes": 25})
    assert focus.status_code == 200
    assert focus.json()["focus_hours"] > before
