"""Persist 100 varied consumer-led and 100 expert-led Gangnam journeys.

This is an explicit data-generation test, not part of routine CI. Keep the
output manifest to reconcile every created row after the run.
"""

import json
import os
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import quote
from uuid import uuid4


BASE = os.getenv("MARKET_TEST_BASE", "http://192.168.0.213:23913/api/v1")
RUN = os.getenv("SCENARIO_RUN_ID", "gangnam-20260927")
MANIFEST = Path(os.getenv("SCENARIO_MANIFEST", "docs/test-results/gangnam-200-20260927.json"))
CATEGORIES = ["design_development", "video_editing", "translation", "legal",
              "cleaning_interior", "pets", "hair_beauty"]
NEEDS = ["모바일 앱", "홍보 영상", "서류 번역", "계약서 검토", "실내 청소", "반려동물 돌봄", "헤어 스타일링"]


def call(method, path, body=None, token=None, expected=(200, 201, 204)):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(BASE + quote(path, safe="/?&=%"), data=json.dumps(body, ensure_ascii=False).encode("utf-8")
                      if body is not None else None, headers=headers, method=method)
    for attempt in range(3):
        try:
            with urlopen(request, timeout=20) as response:
                result = json.load(response) if response.status != 204 else None
                if response.status not in expected:
                    raise AssertionError(f"{method} {path}: {response.status} {result}")
                return result
        except HTTPError as error:
            raise AssertionError(f"{method} {path}: {error.code} {error.read().decode()}") from error
        except URLError:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def login(kind, number):
    ci = f"TEST-CI-KIMGOSU-{kind.upper()}-{number:03d}"
    result = call("POST", "/auth/test-login", {"ci": ci})
    return result["accessToken"], result["customer"]["userId"]


def send(room, sender, message):
    return call("POST", f"/chat/rooms/{room}/messages",
                {"clientMessageId": str(uuid4()), "text": message}, sender)["id"]


def persist(data):
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    if MANIFEST.exists():
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
        assert data["runId"] == RUN
    else:
        data = {"runId": RUN, "base": BASE, "seedServices": [], "consumerLed": [], "expertLed": []}
    consumers = [login("consumer", number) for number in (1, 2)]
    experts = [login("expert", number) for number in (1, 2)]
    # One portfolio per category/expert makes quote proposals valid without
    # coupling the consumer-led scenario to expert-led iteration order.
    if not data["seedServices"]:
        for expert_no, (token, _) in enumerate(experts, 1):
            for category_no, category in enumerate(CATEGORIES):
                item = call("POST", "/services", {
                    "categoryCode": category,
                    "title": f"[TEST {RUN}] 강남구 {NEEDS[category_no]} 고수 {expert_no} 기본 서비스",
                    "description": f"강남구 고객을 위한 {NEEDS[category_no]} 상담과 작업을 진행합니다. 테스트 포트폴리오입니다.",
                    "mode": "onsite", "regionName": "강남구", "priceFrom": 40000 + 5000 * category_no,
                }, token)
                data["seedServices"].append({"id": item["id"], "expert": expert_no, "category": category})
                persist(data)

    for index in range(len(data["consumerLed"]) + 1, 101):
        consumer_no = 1 + index % 2
        expert_no = 1 + (index // 3) % 2
        consumer = consumers[consumer_no - 1][0]
        expert = experts[expert_no - 1][0]
        category_no = (index - 1) % len(CATEGORIES)
        category = CATEGORIES[category_no]
        need = NEEDS[category_no]
        budget = 60000 + (index % 11) * 15000
        quote = call("POST", "/quote-requests", {
            "categoryCode": category,
            "title": f"[TEST {RUN} C{index:03d}] 강남구 {need} 전문가를 구합니다",
            "description": f"강남구에서 {need} 작업이 필요합니다. 희망 일정은 {1 + index % 28}일이며 예산은 {budget}원입니다.",
            "mode": "onsite", "regionName": "강남구", "budgetMax": budget,
        }, consumer)
        service = next(x for x in data["seedServices"] if x["expert"] == expert_no and x["category"] == category)
        proposal = call("POST", f"/quote-requests/{quote['id']}/proposals", {"serviceId": service["id"]}, expert)
        room = proposal["chatRoomId"]
        messages = [
            send(room, expert, f"[{RUN} C{index:03d}] 안녕하세요. 강남구 {need} 요청을 보고 제안드립니다."),
            send(room, consumer, f"[{RUN} C{index:03d}] {1 + index % 28}일 작업이 가능한가요? 예산은 {budget}원입니다."),
            send(room, expert, f"[{RUN} C{index:03d}] 일정 확인 가능합니다. 필요한 범위를 채팅으로 알려주세요."),
            send(room, consumer, f"[{RUN} C{index:03d}] 감사합니다. 세부 요구사항을 정리해 전달하겠습니다."),
        ]
        assert len(call("GET", f"/chat/rooms/{room}/messages?limit=20", token=consumer)["items"]) == 4
        data["consumerLed"].append({"n": index, "quote": quote["id"], "proposal": proposal["proposalId"],
                                    "room": room, "messages": messages, "consumer": consumer_no,
                                    "expert": expert_no, "category": category})
        persist(data)
        if index % 10 == 0:
            print(f"consumer-led {index}/100", flush=True)

    for index in range(len(data["expertLed"]) + 1, 101):
        expert_no = 1 + index % 2
        consumer_no = 1 + (index // 3) % 2
        expert = experts[expert_no - 1][0]
        consumer = consumers[consumer_no - 1][0]
        category_no = (index * 3) % len(CATEGORIES)
        category = CATEGORIES[category_no]
        need = NEEDS[category_no]
        price = 35000 + (index % 13) * 7000
        service = call("POST", "/services", {
            "categoryCode": category,
            "title": f"[TEST {RUN} E{index:03d}] 강남구 {need} 포트폴리오",
            "description": f"강남구에서 진행한 {need} 사례 {index}번입니다. 상담 후 작업 범위와 일정을 정합니다.",
            "mode": "onsite", "regionName": "강남구", "priceFrom": price,
        }, expert)
        call("PUT", f"/services/{service['id']}/favorite", {}, consumer, expected=(204,))
        inquiry = call("POST", f"/services/{service['id']}/inquiries", {}, consumer)
        room = inquiry["chatRoomId"]
        messages = [
            send(room, consumer, f"[{RUN} E{index:03d}] 강남구 {need} 포트폴리오를 보고 문의드립니다."),
            send(room, expert, f"[{RUN} E{index:03d}] 안녕하세요. 어떤 작업 범위를 생각하시나요?"),
            send(room, consumer, f"[{RUN} E{index:03d}] 예산 {price}원부터 가능한지와 일정이 궁금합니다."),
            send(room, expert, f"[{RUN} E{index:03d}] 상담 가능합니다. 원하시는 날짜를 알려주세요."),
        ]
        assert len(call("GET", f"/chat/rooms/{room}/messages?limit=20", token=expert)["items"]) == 4
        data["expertLed"].append({"n": index, "service": service["id"], "room": room,
                                  "messages": messages, "consumer": consumer_no,
                                  "expert": expert_no, "category": category})
        persist(data)
        if index % 10 == 0:
            print(f"expert-led {index}/100", flush=True)
    print(f"PASS {RUN}: {len(data['consumerLed'])} consumer-led, {len(data['expertLed'])} expert-led", flush=True)


if __name__ == "__main__":
    main()
