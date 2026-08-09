from __future__ import annotations

from fastapi import APIRouter

from app.schemas import TutorMessage, TutorReply

router = APIRouter()


@router.post("/ask", response_model=TutorReply)
def ask_tutor(payload: TutorMessage) -> TutorReply:
    topic = payload.subject or "your studies"
    text = payload.message.strip()

    if not text:
        return TutorReply(
            reply="Ask me anything about your notes — I'll break it down step by step."
        )

    lower = text.lower()
    if "flashcard" in lower or "card" in lower:
        reply = (
            f"For {topic}, start with active recall: hide the answer, say it out loud, "
            "then check. Spaced repetition beats rereading every time."
        )
    elif "quiz" in lower or "test" in lower:
        reply = (
            f"Before a quiz on {topic}, do a quick warm-up: 5 flashcards you got wrong last time, "
            "then one timed practice set. Review only the misses afterward."
        )
    elif "explain" in lower or "how" in lower or "what" in lower:
        reply = (
            f"Let's break that down for {topic}.\n\n"
            f"1) Restate the question in your own words.\n"
            f"2) Identify the core idea behind: \"{text}\".\n"
            f"3) Connect it to one example you already know.\n"
            f"4) Teach it back in one sentence.\n\n"
            "Want a worked example next?"
        )
    else:
        reply = (
            f"Here's a study plan for {topic} based on your question:\n\n"
            f"• Clarify: \"{text}\"\n"
            "• Study 10 focused minutes with flashcards\n"
            "• Explain the idea out loud (Voice Explain)\n"
            "• Take a short quiz to lock it in\n\n"
            "Ask a follow-up and I'll go deeper step by step."
        )

    return TutorReply(reply=reply)
