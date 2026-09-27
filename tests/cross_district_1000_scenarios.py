"""Persistent 500 Gangnam consumer + 500 Yeongdeungpo expert journeys.

Run manually against the LAN test API. This deliberately creates visible,
labelled test data; the manifest supports auditing and restart after failure.
"""

import json
import os
from pathlib import Path
from uuid import uuid4

from gangnam_200_scenarios import call, send, CATEGORIES, NEEDS


RUN = "cross-district-20260927"
MANIFEST = Path("docs/test-results/cross-district-1000-20260927.json")


def save(data):
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def login(role, n):
    ci = f"TEST-CI-KIMGOSU-{role}-{n:03d}"
    profile = call("POST", "/auth/test-login", {"ci": ci})
    return profile["accessToken"], profile["customer"]["userId"]


def expect_status(method, path, body=None, token=None, status=403):
    # call() reports HTTP error via AssertionError; inspect the exact status.
    try:
        call(method, path, body, token)
    except AssertionError as exc:
        if f": {status} " not in str(exc):
            raise
        return
    raise AssertionError(f"Expected HTTP {status}: {method} {path}")


def run_one(index, stream, consumers, experts):
    consumer_no = 1 + (index - 1) % 50
    expert_no = 1 + (index * 7 - 1) % 50
    consumer = consumers[consumer_no - 1][0]
    expert = experts[expert_no - 1][0]
    category_no = (index * (3 if stream == "expertLed" else 1)) % len(CATEGORIES)
    category = CATEGORIES[category_no]
    need = NEEDS[category_no]
    minimum = 45000 + (index % 19) * 6000
    requested = minimum + 25000 + (index % 5) * 4000
    offer = requested - 10000 - (index % 3) * 2000
    code = f"{'C' if stream == 'consumerLed' else 'E'}{index:03d}"
    title = f"[TEST {RUN} {code}] 영등포구 고수의 {need} 포트폴리오"
    service = call("POST", "/services", {
        "categoryCode": category, "title": title,
        "description": f"영등포구 거주 고수 {expert_no}의 {need} 실적입니다. 강남구 고객과 비대면으로 협의합니다. 사례 {index}.",
        "mode": "remote", "regionName": None, "priceFrom": minimum,
    }, expert)
    # Consumer follows the same search/detail/inquiry path as the app.
    matches = call("GET", f"/services?q={code}&categoryCode={category}&limit=50")["items"]
    assert any(item["id"] == service["id"] for item in matches), code
    detail = call("GET", f"/services/{service['id']}")
    assert detail["ownerUserId"] == experts[expert_no - 1][1]
    room = call("POST", f"/services/{service['id']}/inquiries", {}, consumer)["chatRoomId"]
    messages = [
        send(room, consumer, f"[{RUN} {code}] 강남구에 거주합니다. 포트폴리오를 보고 {need} 상담드립니다. {requested:,}원에 가능할까요?"),
        send(room, expert, f"[{RUN} {code}] 문의 감사합니다. 영등포구에서 비대면 진행 가능하며 기본가는 {minimum:,}원입니다."),
        send(room, consumer, f"[{RUN} {code}] 범위를 조금 넓혀 {offer:,}원으로 진행할 수 있을까요?"),
        send(room, expert, f"[{RUN} {code}] 그 범위라면 {offer + 5000:,}원을 제안드립니다. 일정은 {1 + index % 28}일입니다."),
        send(room, consumer, f"[{RUN} {code}] {offer + 5000:,}원 제안을 확인했습니다. 세부 내용을 더 협의하겠습니다."),
        send(room, expert, f"[{RUN} {code}] 좋습니다. 최종 가격과 범위는 확인 후 확정하겠습니다."),
    ]
    read = call("GET", f"/chat/rooms/{room}/messages?limit=20", token=consumer)["items"]
    assert len(read) == 6 and [x["id"] for x in read] == messages
    return {"n": index, "code": code, "consumer": consumer_no, "expert": expert_no,
            "category": category, "service": service["id"], "room": room,
            "messages": messages, "minimum": minimum, "counterOffer": offer + 5000}


def abnormal_checks(consumers, experts, sample):
    consumer = consumers[0][0]
    other_consumer = consumers[1][0]
    expert = experts[sample["expert"] - 1][0]
    other_expert = experts[sample["expert"] % 50][0]
    service_id, room_id = sample["service"], sample["room"]
    cases = []
    def check(name, method, path, body=None, token=None, status=403):
        expect_status(method, path, body, token, status)
        cases.append({"case": name, "status": status})
    check("anonymous message", "POST", f"/chat/rooms/{room_id}/messages",
          {"clientMessageId": str(uuid4()), "text": "unauthorized"}, status=401)
    check("unrelated consumer reads room", "GET", f"/chat/rooms/{room_id}/messages", token=other_consumer, status=404)
    check("unrelated expert sends message", "POST", f"/chat/rooms/{room_id}/messages",
          {"clientMessageId": str(uuid4()), "text": "intrusion"}, other_expert, 404)
    check("expert inquires own portfolio", "POST", f"/services/{service_id}/inquiries", {}, expert, 403)
    check("consumer creates service", "POST", "/services", {
        "categoryCode": CATEGORIES[0], "title": "권한 없는 서비스", "description": "소비자의 서비스 등록은 금지됩니다.",
        "mode": "remote", "priceFrom": 1}, consumer, 403)
    check("missing onsite region", "POST", "/services", {
        "categoryCode": CATEGORIES[0], "title": "지역 누락 서비스", "description": "대면 지역이 누락된 테스트 서비스입니다.",
        "mode": "onsite", "priceFrom": 1}, expert, 422)
    check("unknown category", "POST", "/services", {
        "categoryCode": "not_a_category", "title": "잘못된 분야", "description": "존재하지 않는 카테고리 테스트입니다.",
        "mode": "remote", "priceFrom": 1}, expert, 422)
    check("consumer changes expert portfolio", "PUT", f"/services/{service_id}", {
        "categoryCode": sample["category"], "title": "권한 없는 수정", "description": "타인 소유의 서비스를 바꾸려는 요청입니다.",
        "mode": "remote", "priceFrom": 1}, consumer, 403)
    check("empty message", "POST", f"/chat/rooms/{room_id}/messages",
          {"clientMessageId": str(uuid4()), "text": " "}, consumer, 422)
    # Reopening an existing inquiry must be idempotent, preserving its room.
    assert call("POST", f"/services/{service_id}/inquiries", {}, consumer)["chatRoomId"] == room_id
    cases.append({"case": "duplicate inquiry reuses room", "status": 201})
    return cases


def main():
    data = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {
        "runId": RUN, "consumerLed": [], "expertLed": [], "abnormal": []}
    assert data["runId"] == RUN
    consumers = [login("CONSUMER", n) for n in range(1, 51)]
    experts = [login("EXPERT", n) for n in range(1, 51)]
    # First two accounts predate the expanded synthetic profile; set their
    # location through the public self-profile API, as a real user would.
    for token, _ in consumers:
        call("PATCH", "/customers/me", {"homeAddress": "서울특별시 강남구"}, token)
    for token, _ in experts:
        call("PATCH", "/customers/me", {"homeAddress": "서울특별시 영등포구"}, token)
    for stream in ("consumerLed", "expertLed"):
        for index in range(len(data[stream]) + 1, 501):
            data[stream].append(run_one(index, stream, consumers, experts))
            save(data)
            if index % 50 == 0:
                print(f"{stream} {index}/500", flush=True)
    if not data["abnormal"]:
        data["abnormal"] = abnormal_checks(consumers, experts, data["consumerLed"][0])
        save(data)
    print(f"PASS: {len(data['consumerLed'])} consumer, {len(data['expertLed'])} expert, "
          f"{len(data['abnormal'])} abnormal checks", flush=True)


if __name__ == "__main__":
    main()
