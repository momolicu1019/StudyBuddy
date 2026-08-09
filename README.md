# StudyBuddy AI

Cross-platform study companion for **iOS** and **Android**, built with:

- **React Native (Expo)** — mobile UI matching the StudyBuddy AI prototype
- **Python (FastAPI)** — REST API for subjects, flashcards, quiz, AI tutor, and stats

## Features

- Dashboard with note upload (PDF / photo) → generate flashcards
- Subject folders (create, rename, delete, search)
- Flashcard study mode
- Quiz mode with scoring
- AI Tutor chat
- Pomodoro focus timer
- Study progress stats

## Project structure

```
backend/          Python FastAPI API
mobile/           Expo React Native app (iOS + Android)
```

## Backend setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs: http://localhost:8000/docs

### Tests

```bash
cd backend
source .venv/bin/activate
pytest
```

## Mobile app setup

```bash
cd mobile
npm install
npm start
```

Then press:

- `i` for iOS simulator (macOS)
- `a` for Android emulator
- scan the QR code with Expo Go on a physical device

### Pointing at the API

By default the app calls:

- iOS simulator → `http://localhost:8000`
- Android emulator → `http://10.0.2.2:8000`

Override with:

```bash
EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:8000 npm start
```

## Design

The mobile UI follows `study_buddy_ai_ui_prototype` look and feel:

- Primary purple `#6C63FF`
- Soft lilac backgrounds / cards
- Rounded 20px cards, dashed upload zone
- Dashboard → Flashcards → Quiz → AI Tutor → Pomodoro navigation
