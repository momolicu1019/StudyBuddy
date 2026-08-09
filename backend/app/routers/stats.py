from __future__ import annotations

from fastapi import APIRouter

from app.database import load_data, save_data
from app.schemas import FocusSession, Stats

router = APIRouter()


@router.get("", response_model=Stats)
def get_stats() -> Stats:
    return load_data()["stats"]


@router.post("/focus", response_model=Stats)
def log_focus(session: FocusSession) -> Stats:
    data = load_data()
    data["stats"]["focus_hours"] = round(
        data["stats"]["focus_hours"] + (session.minutes / 60), 1
    )
    save_data(data)
    return data["stats"]
