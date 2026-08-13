from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class UpsertUserRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=200)
    local_auth_id: str | None = Field(default=None, max_length=200)


class ChatUserOut(BaseModel):
    id: str
    email: EmailStr
    name: str

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    token: str
    user: ChatUserOut


class OpenDmRequest(BaseModel):
    peer_email: EmailStr


class ConversationOut(BaseModel):
    id: str
    peer: ChatUserOut
    last_message: str | None = None
    last_message_at: datetime | None = None
    unread_count: int = 0


class SendMessageRequest(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    sender_id: str
    body: str
    created_at: datetime

    model_config = {"from_attributes": True}


class MessagesResponse(BaseModel):
    messages: list[MessageOut]
