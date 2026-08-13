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

This FastAPI project is the **optional cloud** layer for later:

| Cloud | Purpose |
|---|---|
| Backup | Remote copies of local data |
| Account | Sign-in / profile |
| Sync | Keep devices consistent |
| Devices | Multi-device management |
| **Chat** | Student 1:1 DMs (`/api/chat/*`) on Neon Postgres |

You do **not** need to run this server for normal study features. **Student chat** does require this API + a Postgres database (Neon works well).

### Student chat (REST MVP)

1. Copy `.env.example` → `.env` and set:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST/neondb?sslmode=require
CHAT_JWT_SECRET=a-long-random-secret
```

2. Install deps and run the API (tables are created automatically on startup):

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

3. Point the mobile app at the API with `EXPO_PUBLIC_CHAT_API_URL` (see `mobile/.env.example`).

Chat endpoints: `POST /api/chat/auth/upsert`, `POST /api/chat/dms`, `GET /api/chat/conversations`, `GET|POST /api/chat/conversations/{id}/messages`.

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
