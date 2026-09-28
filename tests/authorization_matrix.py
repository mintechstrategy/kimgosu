"""Cross-account authorization regression against the LAN test API.

Creates two temporary posts and removes them at the end. Run only where
TEST_LOGIN_ENABLED=true, never against the public deployment endpoint.
"""

import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen


BASE = os.getenv("AUTH_TEST_BASE", "http://192.168.0.213:23913/api/v1")


def call(method, path, token=None, body=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(BASE + path, method=method, headers=headers,
                      data=json.dumps(body).encode() if body is not None else None)
    try:
        with urlopen(request, timeout=15) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except HTTPError as error:
        return error.code, error.read().decode()


def login(role, number):
    status, data = call("POST", "/auth/test-login", body={
        "ci": f"TEST-CI-KIMGOSU-{role}-{number:03d}"})
    assert status == 200, (status, data)
    return data["accessToken"], data["customer"]["userId"]


def denied(method, path, token, body=None, expected=(401, 403, 404)):
    status, result = call(method, path, token, body)
    assert status in expected, (method, path, status, result)
    return status


def main():
    owner, owner_id = login("EXPERT", 49)
    stranger, stranger_id = login("EXPERT", 50)
    consumer, consumer_id = login("CONSUMER", 49)
    other_consumer, _ = login("CONSUMER", 50)
    assert len({owner_id, stranger_id, consumer_id}) == 3
    service = {"categoryCode": "design_development", "title": "권한 회귀 서비스",
               "description": "교차 계정 수정과 삭제 권한을 검증하는 테스트 서비스입니다.",
               "mode": "remote", "priceFrom": 50000}
    quote = {"categoryCode": "design_development", "title": "권한 회귀 견적",
             "description": "교차 계정 수정과 삭제 권한을 검증하는 테스트 견적입니다.",
             "mode": "remote", "budgetMax": 80000}
    status, created_service = call("POST", "/services", owner, service)
    assert status == 201, (status, created_service)
    service_id = created_service["id"]
    status, created_quote = call("POST", "/quote-requests", consumer, quote)
    assert status == 201, (status, created_quote)
    quote_id = created_quote["id"]
    try:
        for method, suffix, body in [
            ("PUT", "", service), ("POST", "/hide", {}), ("DELETE", "", None)]:
            denied(method, f"/services/{service_id}{suffix}", stranger, body)
            denied(method, f"/services/{service_id}{suffix}", consumer, body)
        for method, suffix, body in [
            ("PUT", "", quote), ("POST", "/close", {}), ("DELETE", "", None)]:
            denied(method, f"/quote-requests/{quote_id}{suffix}", other_consumer, body)
            denied(method, f"/quote-requests/{quote_id}{suffix}", owner, body)
        denied("PUT", f"/services/{service_id}", None, service)
        denied("PUT", f"/quote-requests/{quote_id}", None, quote)
        assert call("GET", f"/services/{service_id}")[1]["title"] == service["title"]
        assert call("GET", f"/quote-requests/{quote_id}")[1]["title"] == quote["title"]
        status, inquiry = call("POST", f"/services/{service_id}/inquiries", consumer, {})
        assert status == 201, (status, inquiry)
        room_id = inquiry["chatRoomId"]
        for path in [f"/chat/rooms/{room_id}", f"/chat/rooms/{room_id}/messages",
                     f"/chat/rooms/{room_id}/completion", f"/chat/rooms/{room_id}/reviews"]:
            denied("GET", path, stranger)
        denied("POST", f"/chat/rooms/{room_id}/completion", stranger, {})
        denied("POST", f"/chat/rooms/{room_id}/reviews", stranger,
               {"rating": 5, "body": "unauthorized"})
        assert call("GET", "/customers/me", owner)[1]["userId"] == owner_id
        assert call("GET", "/customers/me", stranger)[1]["userId"] == stranger_id
        print("PASS: cross-account service, quote, chat, review and profile authorization")
    finally:
        assert call("DELETE", f"/quote-requests/{quote_id}", consumer)[0] == 204
        assert call("DELETE", f"/services/{service_id}", owner)[0] == 204


if __name__ == "__main__":
    main()
