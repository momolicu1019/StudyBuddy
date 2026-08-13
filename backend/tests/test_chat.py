from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def _auth(client: TestClient, email: str, name: str):
    res = client.post(
        "/api/chat/auth/upsert",
        json={"email": email, "name": name, "local_auth_id": f"local-{email}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    return body["token"], body["user"]


def test_chat_auth_and_dm_flow(client: TestClient):
    token_a, user_a = _auth(client, "alice@school.edu", "Alice")
    token_b, user_b = _auth(client, "bob@school.edu", "Bob")

    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # Peer must exist before DM can open.
    missing = client.post(
        "/api/chat/dms",
        headers=headers_a,
        json={"peer_email": "nobody@school.edu"},
    )
    assert missing.status_code == 404

    opened = client.post(
        "/api/chat/dms",
        headers=headers_a,
        json={"peer_email": "bob@school.edu"},
    )
    assert opened.status_code == 201, opened.text
    conv = opened.json()
    assert conv["peer"]["email"] == "bob@school.edu"
    assert conv["unread_count"] == 0

    # Same pair returns existing conversation.
    again = client.post(
        "/api/chat/dms",
        headers=headers_a,
        json={"peer_email": "Bob@school.edu"},
    )
    assert again.status_code == 201
    assert again.json()["id"] == conv["id"]

    sent = client.post(
        f"/api/chat/conversations/{conv['id']}/messages",
        headers=headers_a,
        json={"body": "Hey Bob, study later?"},
    )
    assert sent.status_code == 201, sent.text
    msg = sent.json()
    assert msg["body"] == "Hey Bob, study later?"
    assert msg["sender_id"] == user_a["id"]

    inbox_b = client.get("/api/chat/conversations", headers=headers_b)
    assert inbox_b.status_code == 200
    rows = inbox_b.json()
    assert len(rows) == 1
    assert rows[0]["peer"]["email"] == "alice@school.edu"
    assert rows[0]["last_message"] == "Hey Bob, study later?"
    assert rows[0]["unread_count"] >= 1

    listed = client.get(
        f"/api/chat/conversations/{conv['id']}/messages",
        headers=headers_b,
    )
    assert listed.status_code == 200
    messages = listed.json()["messages"]
    assert len(messages) == 1
    assert messages[0]["body"] == "Hey Bob, study later?"

    # After reading, unread clears.
    inbox_b2 = client.get("/api/chat/conversations", headers=headers_b)
    assert inbox_b2.json()[0]["unread_count"] == 0

    # Poll after_id
    polled = client.get(
        f"/api/chat/conversations/{conv['id']}/messages",
        headers=headers_a,
        params={"after_id": msg["id"]},
    )
    assert polled.status_code == 200
    assert polled.json()["messages"] == []


def test_chat_requires_auth(client: TestClient):
    res = client.get("/api/chat/conversations")
    assert res.status_code == 401
