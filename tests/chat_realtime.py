"""Verify WebSocket delivery through Nginx using a one-time ticket."""

import json
import os
from uuid import uuid4

from websocket import create_connection

from chat_smoke import call, token


def main():
    owner, visitor = uuid4(), uuid4()
    subject = call("POST", "/subjects", token(uuid4(), "chat:subjects:write"),
                   {"subjectType": "future_service", "subjectId": str(uuid4()),
                    "ownerUserId": str(owner)}, 201)
    room = call("POST", "/rooms", token(visitor), {"subjectId": subject["id"]}, 201)
    ticket = call("POST", f"/rooms/{room['id']}/ws-ticket", token(owner))["ticket"]
    ws_url = f"ws://127.0.0.1:{os.getenv('CHAT_TEST_HTTP_PORT', '18080')}/api/v1/chat/ws/rooms/{room['id']}?ticket={ticket}"
    ws = create_connection(ws_url, timeout=5)
    try:
        message = call("POST", f"/rooms/{room['id']}/messages", token(visitor),
                       {"clientMessageId": str(uuid4()), "text": "realtime check"}, 201)
        event = json.loads(ws.recv())
        assert event["type"] == "message.created"
        assert event["message"]["id"] == message["id"]
    finally:
        ws.close()
    print("PASS: WebSocket delivery through Nginx")


if __name__ == "__main__":
    main()
