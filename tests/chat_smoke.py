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


def upload(room_id, bearer, payload=b"file-content"):
    boundary = "kimgosu-test-boundary"
    data = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"example.txt\"\r\n"
            "Content-Type: text/plain\r\n\r\n").encode() + payload + f"\r\n--{boundary}--\r\n".encode()
    req = Request(BASE + f"/rooms/{room_id}/attachments", method="POST", data=data,
                  headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                           "Authorization": f"Bearer {bearer}"})
    with urlopen(req, timeout=10) as response:
        assert response.status == 201
        return json.load(response)


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
    attachment = upload(room["id"], visitor_token)
    call("GET", f"/attachments/{attachment['id']}/download", owner_token, expected=404)
    attachment_message = call("POST", path, visitor_token,
                              {"clientMessageId": str(uuid4()), "attachmentIds": [attachment["id"]]}, 201)
    assert attachment_message["attachments"][0]["id"] == attachment["id"]
    download = Request(BASE + f"/attachments/{attachment['id']}/download",
                       headers={"Authorization": f"Bearer {owner_token}"})
    with urlopen(download, timeout=10) as response:
        assert response.read() == b"file-content"
    call("GET", f"/attachments/{attachment['id']}/download", stranger_token, expected=404)
    unsent = upload(room["id"], visitor_token)
    call("DELETE", f"/attachments/{unsent['id']}", visitor_token, expected=204)
    listing = call("GET", path, owner_token)
    assert [m["id"] for m in listing["items"]] == [message["id"], attachment_message["id"]]
    rooms = call("GET", "/rooms", owner_token)
    assert rooms["items"][0]["unreadCount"] == 2
    second_subject = call("POST", "/subjects", writer, {"subjectType": "future_service",
        "subjectId": str(uuid4()), "ownerUserId": str(owner)}, 201)
    call("POST", "/rooms", visitor_token, {"subjectId": second_subject["id"]}, 201)
    first_page = call("GET", "/rooms?limit=1", owner_token)
    assert len(first_page["items"]) == 1 and first_page["nextCursor"]
    second_page = call("GET", f"/rooms?limit=1&cursor={first_page['nextCursor']}", owner_token)
    assert len(second_page["items"]) == 1 and second_page["items"][0]["id"] != first_page["items"][0]["id"]
    call("POST", f"/rooms/{room['id']}/read", owner_token,
         {"throughMessageId": message["id"]})
    assert next(item for item in call("GET", "/rooms", owner_token)["items"]
                if item["id"] == room["id"])["unreadCount"] == 1
    call("POST", f"/rooms/{room['id']}/read", owner_token,
         {"throughMessageId": attachment_message["id"]})
    assert next(item for item in call("GET", "/rooms", owner_token)["items"]
                if item["id"] == room["id"])["unreadCount"] == 0
    ticket = call("POST", f"/rooms/{room['id']}/ws-ticket", owner_token)
    assert ticket["ticket"] and ticket["expiresInSeconds"] == 30
    call("POST", f"/rooms/{room['id']}/ws-ticket", stranger_token, expected=404)
    # Customer ledger IDs use provider-prefixed strings; legacy UUID chat users remain readable.
    prefixed_owner = f"kakao_{uuid4().hex}"
    prefixed_visitor = f"naver_{uuid4().hex}"
    prefixed_subject = call("POST", "/subjects", writer, {"subjectType": "future_service",
        "subjectId": str(uuid4()), "ownerUserId": prefixed_owner}, 201)
    prefixed_room = call("POST", "/rooms", token(prefixed_visitor),
                         {"subjectId": prefixed_subject["id"]}, 201)
    prefixed_message = call("POST", f"/rooms/{prefixed_room['id']}/messages",
                            token(prefixed_visitor),
                            {"clientMessageId": str(uuid4()), "text": "prefixed identity"}, 201)
    assert prefixed_message["senderUserId"] == prefixed_visitor
    assert call("GET", f"/rooms/{prefixed_room['id']}", token(prefixed_owner))["participantIds"]
    call("GET", "/rooms", expected=401)
    print("PASS: subjects, rooms, access control, messages, private attachments, read state, tickets")


if __name__ == "__main__":
    main()
