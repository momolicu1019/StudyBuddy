from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.chat.auth import create_access_token, get_current_chat_user
from app.chat.db import get_session
from app.chat.models import ChatUser, Conversation, ConversationMember, Message
from app.chat.schemas import (
    AuthResponse,
    ChatUserOut,
    ConversationOut,
    MessageOut,
    MessagesResponse,
    OpenDmRequest,
    SendMessageRequest,
    UpsertUserRequest,
)

router = APIRouter()


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _dm_key(user_a: str, user_b: str) -> str:
    left, right = sorted([user_a, user_b])
    return f"{left}:{right}"


@router.post("/auth/upsert", response_model=AuthResponse)
async def upsert_chat_user(
    body: UpsertUserRequest,
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    email = _normalize_email(str(body.email))
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    result = await session.execute(select(ChatUser).where(ChatUser.email == email))
    user = result.scalar_one_or_none()
    if user is None:
        user = ChatUser(
            email=email,
            name=name,
            local_auth_id=body.local_auth_id,
        )
        session.add(user)
    else:
        user.name = name
        if body.local_auth_id:
            user.local_auth_id = body.local_auth_id

    await session.commit()
    await session.refresh(user)
    token = create_access_token(user_id=user.id, email=user.email)
    return AuthResponse(token=token, user=ChatUserOut.model_validate(user))


@router.get("/me", response_model=ChatUserOut)
async def get_me(me: ChatUser = Depends(get_current_chat_user)) -> ChatUserOut:
    return ChatUserOut.model_validate(me)


@router.post("/dms", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
async def open_or_get_dm(
    body: OpenDmRequest,
    me: ChatUser = Depends(get_current_chat_user),
    session: AsyncSession = Depends(get_session),
) -> ConversationOut:
    peer_email = _normalize_email(str(body.peer_email))
    if peer_email == me.email:
        raise HTTPException(status_code=400, detail="Cannot start a chat with yourself")

    peer_result = await session.execute(
        select(ChatUser).where(ChatUser.email == peer_email)
    )
    peer = peer_result.scalar_one_or_none()
    if peer is None:
        raise HTTPException(
            status_code=404,
            detail="No Study Buddy user found with that email. They need to open Messages once while signed in.",
        )

    key = _dm_key(me.id, peer.id)
    conv_result = await session.execute(
        select(Conversation)
        .options(selectinload(Conversation.members).selectinload(ConversationMember.user))
        .where(Conversation.dm_key == key)
    )
    conversation = conv_result.scalar_one_or_none()

    if conversation is None:
        conversation = Conversation(dm_key=key)
        session.add(conversation)
        await session.flush()
        session.add(ConversationMember(conversation_id=conversation.id, user_id=me.id))
        session.add(ConversationMember(conversation_id=conversation.id, user_id=peer.id))
        await session.commit()
        conv_result = await session.execute(
            select(Conversation)
            .options(
                selectinload(Conversation.members).selectinload(ConversationMember.user)
            )
            .where(Conversation.id == conversation.id)
        )
        conversation = conv_result.scalar_one()

    return await _conversation_out(session, conversation, me)


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    me: ChatUser = Depends(get_current_chat_user),
    session: AsyncSession = Depends(get_session),
) -> list[ConversationOut]:
    result = await session.execute(
        select(Conversation)
        .join(ConversationMember)
        .where(ConversationMember.user_id == me.id)
        .options(selectinload(Conversation.members).selectinload(ConversationMember.user))
        .order_by(Conversation.updated_at.desc())
    )
    conversations = result.scalars().unique().all()
    out: list[ConversationOut] = []
    for conversation in conversations:
        out.append(await _conversation_out(session, conversation, me))
    return out


@router.get("/conversations/{conversation_id}/messages", response_model=MessagesResponse)
async def list_messages(
    conversation_id: str,
    after_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    me: ChatUser = Depends(get_current_chat_user),
    session: AsyncSession = Depends(get_session),
) -> MessagesResponse:
    await _require_membership(session, conversation_id, me.id)

    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
        .limit(limit)
    )
    if after_id:
        anchor = await session.get(Message, after_id)
        if anchor and anchor.conversation_id == conversation_id:
            stmt = (
                select(Message)
                .where(
                    Message.conversation_id == conversation_id,
                    Message.created_at > anchor.created_at,
                )
                .order_by(Message.created_at.asc())
                .limit(limit)
            )

    result = await session.execute(stmt)
    messages = result.scalars().all()

    # Mark as read
    member_result = await session.execute(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == me.id,
        )
    )
    member = member_result.scalar_one()
    member.last_read_at = datetime.now(timezone.utc)
    await session.commit()

    return MessagesResponse(
        messages=[MessageOut.model_validate(m) for m in messages]
    )


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=MessageOut,
    status_code=status.HTTP_201_CREATED,
)
async def send_message(
    conversation_id: str,
    body: SendMessageRequest,
    me: ChatUser = Depends(get_current_chat_user),
    session: AsyncSession = Depends(get_session),
) -> MessageOut:
    await _require_membership(session, conversation_id, me.id)
    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    message = Message(
        conversation_id=conversation_id,
        sender_id=me.id,
        body=text,
    )
    session.add(message)

    conversation = await session.get(Conversation, conversation_id)
    if conversation:
        conversation.updated_at = datetime.now(timezone.utc)

    member_result = await session.execute(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == me.id,
        )
    )
    member = member_result.scalar_one()
    member.last_read_at = datetime.now(timezone.utc)

    await session.commit()
    await session.refresh(message)
    return MessageOut.model_validate(message)


async def _require_membership(
    session: AsyncSession, conversation_id: str, user_id: str
) -> None:
    result = await session.execute(
        select(ConversationMember.id).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Conversation not found")


async def _conversation_out(
    session: AsyncSession, conversation: Conversation, me: ChatUser
) -> ConversationOut:
    peer_member = next((m for m in conversation.members if m.user_id != me.id), None)
    if peer_member is None or peer_member.user is None:
        raise HTTPException(status_code=500, detail="DM peer missing")

    my_member = next((m for m in conversation.members if m.user_id == me.id), None)
    last_read = my_member.last_read_at if my_member else None

    last_msg_result = await session.execute(
        select(Message)
        .where(Message.conversation_id == conversation.id)
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    last_msg = last_msg_result.scalar_one_or_none()

    unread_filters = [
        Message.conversation_id == conversation.id,
        Message.sender_id != me.id,
    ]
    if last_read is not None:
        unread_filters.append(Message.created_at > last_read)

    unread_result = await session.execute(
        select(func.count()).select_from(Message).where(and_(*unread_filters))
    )
    unread_count = int(unread_result.scalar_one() or 0)

    return ConversationOut(
        id=conversation.id,
        peer=ChatUserOut.model_validate(peer_member.user),
        last_message=last_msg.body if last_msg else None,
        last_message_at=last_msg.created_at if last_msg else conversation.updated_at,
        unread_count=unread_count,
    )
