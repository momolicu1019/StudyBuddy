from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.database import load_data, save_data
from app.schemas import Subject, SubjectCreate, SubjectUpdate

router = APIRouter()


@router.get("", response_model=list[Subject])
def list_subjects(q: str | None = None) -> list[Subject]:
    data = load_data()
    subjects = data["subjects"]
    if q:
        needle = q.lower()
        subjects = [s for s in subjects if needle in s["name"].lower()]
    return subjects


@router.get("/{subject_id}", response_model=Subject)
def get_subject(subject_id: int) -> Subject:
    data = load_data()
    for subject in data["subjects"]:
        if subject["id"] == subject_id:
            return subject
    raise HTTPException(status_code=404, detail="Subject not found")


@router.post("", response_model=Subject, status_code=201)
def create_subject(payload: SubjectCreate) -> Subject:
    data = load_data()
    subject = {
        "id": data["next_subject_id"],
        "name": payload.name.strip(),
        "icon": payload.icon,
        "cards": 0,
        "mastered": 0,
        "last": "Not studied yet",
    }
    data["next_subject_id"] += 1
    data["subjects"].append(subject)
    data["flashcards"][str(subject["id"])] = []
    save_data(data)
    return subject


@router.patch("/{subject_id}", response_model=Subject)
def update_subject(subject_id: int, payload: SubjectUpdate) -> Subject:
    data = load_data()
    for subject in data["subjects"]:
        if subject["id"] == subject_id:
            if payload.name is not None:
                subject["name"] = payload.name.strip()
            if payload.icon is not None:
                subject["icon"] = payload.icon
            save_data(data)
            return subject
    raise HTTPException(status_code=404, detail="Subject not found")


@router.delete("/{subject_id}")
def delete_subject(subject_id: int) -> dict[str, str]:
    data = load_data()
    before = len(data["subjects"])
    data["subjects"] = [s for s in data["subjects"] if s["id"] != subject_id]
    if len(data["subjects"]) == before:
        raise HTTPException(status_code=404, detail="Subject not found")
    data["flashcards"].pop(str(subject_id), None)
    save_data(data)
    return {"status": "deleted"}
