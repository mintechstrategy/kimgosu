"""Persist one 55-message consumer/expert negotiation and verify chat cursors.

Run manually against the LAN test API. This intentionally writes lasting test data.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from uuid import uuid4


BASE = os.getenv("MARKET_TEST_BASE", "http://192.168.0.213:23913/api/v1")
OUTPUT = Path("docs/test-results/chat-long-history-latest.json")


def call(method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(BASE + path, method=method, headers=headers,
                      data=json.dumps(body).encode() if body is not None else None)
    with urlopen(request, timeout=10) as response:
        return json.load(response) if response.status != 204 else None


def login(role):
    result = call("POST", "/auth/test-login", {"ci": f"TEST-CI-KIMGOSU-{role}-001"})
    return result["accessToken"], result["customer"]["userId"]


def main():
    consumer, consumer_id = login("CONSUMER")
    expert, expert_id = login("EXPERT")
    marker = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    title = f"[TEST IT-309] 긴 채팅 검증 {marker}"
    service = call("POST", "/services", {
        "categoryCode": "design_development", "title": title,
        "description": "메시지 페이지 이동과 대화 기록 보존을 확인하는 테스트 포트폴리오입니다.",
        "mode": "remote", "priceFrom": 55000,
    }, expert)
    room = call("POST", f"/services/{service['id']}/inquiries", {}, consumer)
    room_id = room["chatRoomId"]
    ids = []
    for number in range(55):
        sender = consumer if number % 2 == 0 else expert
        text = (f"{number + 1:02d}/55 " +
                (f"희망 예산 {60000 + number * 500}원입니다." if number % 2 == 0
                 else f"고수 제안가 {65000 + number * 500}원입니다."))
        sent = call("POST", f"/chat/rooms/{room_id}/messages",
                    {"clientMessageId": str(uuid4()), "text": text}, sender)
        ids.append(sent["id"])
    latest = call("GET", f"/chat/rooms/{room_id}/messages?limit=50", token=consumer)
    assert len(latest["items"]) == 50 and latest["nextCursor"]
    older = call("GET", f"/chat/rooms/{room_id}/messages?limit=50&before={latest['nextCursor']}",
                 token=consumer)
    assert len(older["items"]) == 5 and older["nextCursor"] is None
    returned = [item["id"] for item in older["items"] + latest["items"]]
    assert returned == ids, "History page order or contents differ"
    summary = {"executedAt": datetime.now(timezone.utc).isoformat(), "scenarioId": "IT-309",
               "title": title, "consumerUserId": consumer_id, "expertUserId": expert_id,
               "serviceId": service["id"], "roomId": room_id, "messageCount": 55,
               "firstPageCount": 50, "olderPageCount": 5}
    OUTPUT.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"PASS: {title}; 55 messages across 50+5 pages; room {room_id}")


if __name__ == "__main__":
    main()
