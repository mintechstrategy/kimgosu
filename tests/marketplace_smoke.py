"""Exercise the consumer/expert marketplace journey against an isolated Compose stack."""

import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen


BASE = os.getenv("MARKET_TEST_BASE", "http://127.0.0.1:18084/api/v1")


def call(method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                      headers=headers, method=method)
    try:
        with urlopen(request, timeout=10) as response:
            return response.status, json.load(response) if response.status != 204 else None
    except HTTPError as error:
        return error.code, error.read().decode()


def login(ci):
    status, result = call("POST", "/auth/test-login", {"ci": ci})
    assert status == 200, result
    return result["accessToken"], result["customer"]["userId"]


def main():
    consumer, consumer_id = login("TEST-CI-KIMGOSU-CONSUMER-001")
    expert, expert_id = login("TEST-CI-KIMGOSU-EXPERT-001")
    service = {"categoryCode": "design_development", "title": "앱 화면 구현",
               "description": "안드로이드 앱 화면과 API 연동을 구현합니다.", "mode": "remote",
               "priceFrom": 50000}
    assert call("POST", "/services", service, consumer)[0] == 403
    status, created = call("POST", "/services", service, expert)
    assert status == 201, created
    service_id = created["id"]
    assert call("GET", "/services?categoryCode=design_development")[0] == 200
    assert call("GET", f"/services/{service_id}")[1]["ownerUserId"] == expert_id
    assert call("POST", f"/services/{service_id}/inquiries", {}, expert)[0] == 403
    status, inquiry = call("POST", f"/services/{service_id}/inquiries", {}, consumer)
    assert status == 201, inquiry
    room_id = inquiry["chatRoomId"]
    assert call("POST", f"/services/{service_id}/inquiries", {}, consumer)[1]["chatRoomId"] == room_id
    assert call("GET", f"/chat/rooms/{room_id}", token=consumer)[0] == 200
    assert call("POST", f"/chat/rooms/{room_id}/reviews", {"rating": 5,
           "body": "상담 내용이 정확하고 응답이 친절했습니다."}, consumer)[0] == 409
    assert call("POST", f"/chat/rooms/{room_id}/completion", {}, consumer)[1]["completed"] is False
    assert call("POST", f"/chat/rooms/{room_id}/completion", {}, expert)[1]["completed"] is True
    assert call("POST", f"/chat/rooms/{room_id}/reviews", {"rating": 5,
           "body": "상담 내용이 정확하고 응답이 친절했습니다."}, consumer)[0] == 201
    assert call("POST", f"/chat/rooms/{room_id}/reviews", {"rating": 5,
           "body": "상담 내용이 정확하고 응답이 친절했습니다."}, consumer)[0] == 409
    assert call("PUT", f"/services/{service_id}/favorite", {}, consumer)[0] == 204
    assert len(call("GET", "/me/favorites", token=consumer)[1]["items"]) >= 1

    quote = {"categoryCode": "design_development", "title": "앱 제작 견적 문의",
             "description": "고객용 안드로이드 앱 제작 견적을 받고 싶습니다.",
             "mode": "remote", "budgetMax": 100000}
    status, requested = call("POST", "/quote-requests", quote, consumer)
    assert status == 201, requested
    quote_id = requested["id"]
    assert call("POST", f"/quote-requests/{quote_id}/proposals", {"serviceId": service_id}, consumer)[0] == 403
    status, proposal = call("POST", f"/quote-requests/{quote_id}/proposals", {"serviceId": service_id}, expert)
    assert status == 201, proposal
    assert proposal["chatRoomId"]
    assert call("POST", f"/quote-requests/{quote_id}/proposals", {"serviceId": service_id}, expert)[1]["created"] is False
    assert len(call("GET", f"/quote-requests/{quote_id}/proposals", token=consumer)[1]["items"]) == 1
    assert call("POST", f"/quote-requests/{quote_id}/close", {}, expert)[0] == 403
    assert call("POST", f"/quote-requests/{quote_id}/close", {}, consumer)[1]["status"] == "closed"
    assert call("PUT", f"/quote-requests/{quote_id}", quote, consumer)[1]["status"] == "closed"
    assert call("DELETE", f"/quote-requests/{quote_id}", token=consumer)[0] == 204
    assert call("GET", f"/quote-requests/{quote_id}")[0] == 404
    assert call("DELETE", f"/services/{service_id}", token=expert)[0] == 204
    assert call("GET", f"/services/{service_id}")[0] == 404
    assert call("GET", f"/chat/rooms/{room_id}", token=consumer)[0] == 200
    print("PASS: service, quote, proposal, favorite, inquiry and chat authorization")


if __name__ == "__main__":
    main()
