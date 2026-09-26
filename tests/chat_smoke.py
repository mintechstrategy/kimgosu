"""End-to-end chat contract smoke test against an isolated Compose stack."""

import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4


BASE = os.getenv("CHAT_TEST_BASE", "http://127.0.0.1:18080/api/v1/chat")
SECRET = Path(os.environ["CHAT_TEST_JWT_SECRET_FILE"]).read_text().strip().encode()


def b64(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def token(user_id, scope=""):
    now = int(time.time())
    header = b64(b'{"alg":"HS256","typ":"JWT"}')
    claims = b64(json.dumps({"sub": str(user_id), "scope": scope, "iat": now,
                             "exp": now + 300, "iss": "kimgosu", "aud": "kimgosu-api"}).encode())
    signing_input = f"{header}.{claims}".encode()
    signature = b64(hmac.new(SECRET, signing_input, hashlib.sha256).digest())
    return f"{header}.{claims}.{signature}"


def call(method, path, bearer=None, body=None, expected=200):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    req = Request(BASE + path, method=method, data=data, headers=headers)
    try:
        with urlopen(req, timeout=10) as response:
            status, raw = response.status, response.read()
    except HTTPError as exc:
        status, raw = exc.code, exc.read()
    assert status == expected, (method, path, status, raw[:300])
    return json.loads(raw) if raw else None


def main():
    owner, visitor, stranger = uuid4(), uuid4(), uuid4()
    owner_token = token(owner)
    visitor_token = token(visitor)
    stranger_token = token(stranger)
    writer = token(uuid4(), "chat:subjects:write")
    subject = call("POST", "/subjects", writer, {"subjectType": "service_inquiry",
        "subjectId": str(uuid4()), "ownerUserId": str(owner)}, 201)
    call("POST", "/subjects", writer, {"subjectType": "service_inquiry",
        "subjectId": subject["subjectId"], "ownerUserId": str(stranger)}, 409)
    room = call("POST", "/rooms", visitor_token, {"subjectId": subject["id"]}, 201)
    assert room["created"] is True
    repeat = call("POST", "/rooms", visitor_token, {"subjectId": subject["id"]}, 201)
    assert repeat["id"] == room["id"] and repeat["created"] is False
    call("POST", "/rooms", owner_token, {"subjectId": subject["id"]}, 403)
    call("GET", f"/rooms/{room['id']}", stranger_token, expected=404)
    client_id = str(uuid4())
    path = f"/rooms/{room['id']}/messages"
    message = call("POST", path, visitor_token,
                   {"clientMessageId": client_id, "text": "Hello"}, 201)
    same = call("POST", path, visitor_token,
                {"clientMessageId": client_id, "text": "Hello"}, 201)
    assert same["id"] == message["id"]
    call("POST", path, visitor_token,
         {"clientMessageId": client_id, "text": "Changed"}, 409)
    call("POST", path, stranger_token,
         {"clientMessageId": str(uuid4()), "text": "No access"}, 404)
    listing = call("GET", path, owner_token)
    assert [m["id"] for m in listing["items"]] == [message["id"]]
    rooms = call("GET", "/rooms", owner_token)
    assert rooms["items"][0]["unreadCount"] == 1
    second_subject = call("POST", "/subjects", writer, {"subjectType": "future_service",
        "subjectId": str(uuid4()), "ownerUserId": str(owner)}, 201)
    call("POST", "/rooms", visitor_token, {"subjectId": second_subject["id"]}, 201)
    first_page = call("GET", "/rooms?limit=1", owner_token)
    assert len(first_page["items"]) == 1 and first_page["nextCursor"]
    second_page = call("GET", f"/rooms?limit=1&cursor={first_page['nextCursor']}", owner_token)
    assert len(second_page["items"]) == 1 and second_page["items"][0]["id"] != first_page["items"][0]["id"]
    call("POST", f"/rooms/{room['id']}/read", owner_token,
         {"throughMessageId": message["id"]})
    assert call("GET", "/rooms", owner_token)["items"][0]["unreadCount"] == 0
    ticket = call("POST", f"/rooms/{room['id']}/ws-ticket", owner_token)
    assert ticket["ticket"] and ticket["expiresInSeconds"] == 30
    call("POST", f"/rooms/{room['id']}/ws-ticket", stranger_token, expected=404)
    call("GET", "/rooms", expected=401)
    print("PASS: subject registration, room reuse, membership, message idempotency, read state, ticket")


if __name__ == "__main__":
    main()
