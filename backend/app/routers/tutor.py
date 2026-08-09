from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from fastapi import APIRouter

from app.schemas import TutorMessage, TutorReply

router = APIRouter()


def _cloud_reply(message: str, subject: str | None) -> str | None:
    api_key = (os.getenv("OPENAI_API_KEY") or os.getenv("AI_API_KEY") or "").strip()
    if not api_key:
        return None

    base_url = (os.getenv("AI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    model = (os.getenv("AI_MODEL") or "gpt-4o-mini").strip()
    topic = subject or "your studies"

    payload = {
        "model": model,
        "temperature": 0.4,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are Study Buddy AI Tutor. Answer the student question directly "
                    "and clearly with concise study-friendly explanations. "
                    f"Subject focus: {topic}."
                ),
            },
            {"role": "user", "content": message},
        ],
    }

    request = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None

    choices = data.get("choices") or []
    if not choices:
        return None
    content = ((choices[0].get("message") or {}).get("content") or "").strip()
    return content or None


@router.post("/ask", response_model=TutorReply)
def ask_tutor(payload: TutorMessage) -> TutorReply:
    topic = payload.subject or "your studies"
    text = payload.message.strip()

    if not text:
        return TutorReply(
            reply="Ask me anything about your notes — I'll break it down step by step."
        )

    cloud = _cloud_reply(text, payload.subject)
    if cloud:
        return TutorReply(reply=cloud)

    return TutorReply(
        reply=(
            f'You asked: "{text}"\n\n'
            f"I can study this with you once an AI key is configured "
            f"(set OPENAI_API_KEY on the backend), or ask from the mobile app "
            f"with EXPO_PUBLIC_AI_API_KEY / your saved flashcards for {topic}."
        )
    )
