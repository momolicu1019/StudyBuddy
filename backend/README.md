# StudyBuddy — Optional Cloud API

The mobile app is **local-first**. Core data lives on the device:

| Local storage | Purpose |
|---|---|
| Flashcards | Study decks |
| Subjects | Folders |
| PDFs / photos | Uploaded note sources |
| Progress | Reviewed cards, quiz average, focus time |
| Quizzes | Quiz result history |
| Settings | App preferences |

This FastAPI project is an **optional cloud** layer for later:

| Cloud | Purpose |
|---|---|
| Backup | Remote copies of local data |
| Account | Sign-in / profile |
| Sync | Keep devices consistent |
| Devices | Multi-device management |

You do **not** need to run this server for normal study features.

**Student chat** is handled by **Firebase** in the mobile app (see `mobile/FIREBASE_CHAT.md`). This backend no longer serves chat.

## Run locally (optional)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs: http://localhost:8000/docs

```bash
pytest
```
