"""Four notification sources, duplicate retries and account isolation."""

import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4


BASE = os.getenv("NOTIFICATION_TEST_BASE", "http://127.0.0.1:18081/api/v1")


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
    status, value = call("POST", "/auth/test-login", body={
        "ci": f"TEST-CI-KIMGOSU-{role}-{number:03d}"})
    assert status == 200, (status, value)
    return value["accessToken"]


def main():
    consumer, expert, stranger = (login("CONSUMER", 47), login("EXPERT", 47),
                                  login("CONSUMER", 46))
    service = {"categoryCode": "design_development", "title": "알림 검증 앱 개발",
               "description": "서비스 문의와 채팅 알림을 검증할 앱 개발 서비스입니다.",
               "mode": "remote", "priceFrom": 50000}
    quote = {"categoryCode": "design_development", "title": "알림 검증 견적 요청",
             "description": "제안 알림과 채팅방 거래 완료 리뷰를 검증합니다.",
             "mode": "remote", "budgetMax": 90000}
    status, created = call("POST", "/services", expert, service)
    assert status == 201, (status, created)
    service_id = created["id"]
    status, created = call("POST", "/quote-requests", consumer, quote)
    assert status == 201, (status, created)
    quote_id = created["id"]
    try:
        status, inquiry = call("POST", f"/services/{service_id}/inquiries", consumer, {})
        assert status == 201
        room = inquiry["chatRoomId"]
        assert call("POST", f"/services/{service_id}/inquiries", consumer, {})[1]["chatRoomId"] == room
        message = {"clientMessageId": str(uuid4()), "text": "문의드립니다. 작업 가능할까요?"}
        assert call("POST", f"/chat/rooms/{room}/messages", consumer, message)[0] == 201
        assert call("POST", f"/chat/rooms/{room}/messages", consumer, message)[0] == 201
        status, proposal = call("POST", f"/quote-requests/{quote_id}/proposals",
                                expert, {"serviceId": service_id})
        assert status == 201 and proposal["created"]
        assert call("POST", f"/quote-requests/{quote_id}/proposals", expert,
                    {"serviceId": service_id})[1]["created"] is False
        assert call("POST", f"/chat/rooms/{room}/completion", consumer, {})[0] == 200
        assert call("POST", f"/chat/rooms/{room}/completion", expert, {})[0] == 200
        assert call("POST", f"/chat/rooms/{room}/reviews", consumer,
                    {"rating": 5, "body": "가격 협의가 친절하고 명확하게 진행됐습니다."})[0] == 201
        expert_items = call("GET", "/notifications", expert)[1]["items"]
        consumer_items = call("GET", "/notifications", consumer)[1]["items"]
        assert {"service.inquiry", "chat.message", "review.created"} <= {
            item["eventType"] for item in expert_items}
        assert "proposal.created" in {item["eventType"] for item in consumer_items}
        assert sum(item["eventType"] == "chat.message" and item["roomId"] == room
                   for item in expert_items) == 1
        assert sum(item["eventType"] == "service.inquiry" and item["roomId"] == room
                   for item in expert_items) == 1
        target = expert_items[0]["id"]
        assert call("POST", f"/notifications/{target}/read", stranger, {})[0] == 404
        assert call("POST", f"/notifications/{target}/read", expert, {})[1]["readAt"]
        assert call("POST", f"/notifications/{target}/read", expert, {})[0] == 200
        assert call("GET", f"/notifications?cursor={target}", stranger)[0] == 404
        assert call("GET", "/notifications", stranger)[1]["items"] == []
        assert call("GET", "/notifications")[0] == 401
        print("PASS: four events, retry dedupe, read state and account isolation")
    finally:
        assert call("DELETE", f"/quote-requests/{quote_id}", consumer)[0] == 204
        assert call("DELETE", f"/services/{service_id}", expert)[0] == 204


if __name__ == "__main__":
    main()
