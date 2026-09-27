"""Exercise bilateral review eligibility, soft deletion and region filtering."""

import json
from pathlib import Path

from cross_district_1000_scenarios import login, expect_status
from gangnam_200_scenarios import call


def main():
    run = json.loads(Path("docs/test-results/cross-district-1000-20260927.json").read_text(encoding="utf-8"))
    sample = run["consumerLed"][1]
    consumer, _ = login("CONSUMER", sample["consumer"])
    expert, _ = login("EXPERT", sample["expert"])
    room = sample["room"]
    review = {"rating": 5, "body": "상담 과정이 친절하고 요구사항과 가격을 명확하게 조율했습니다."}
    expect_status("POST", f"/chat/rooms/{room}/reviews", review, consumer, 409)
    assert call("POST", f"/chat/rooms/{room}/completion", {}, consumer)["completed"] is False
    expect_status("POST", f"/chat/rooms/{room}/reviews", review, consumer, 409)
    assert call("POST", f"/chat/rooms/{room}/completion", {}, expert)["completed"] is True
    assert call("POST", f"/chat/rooms/{room}/reviews", review, consumer)["rating"] == 5
    expect_status("POST", f"/chat/rooms/{room}/reviews", review, consumer, 409)
    assert len(call("GET", f"/chat/rooms/{room}/reviews", token=expert)["items"]) == 1
    assert call("POST", f"/chat/rooms/{room}/completion", {}, consumer)["completed"] is True

    service = call("POST", "/services", {"categoryCode": "design_development",
        "title": "[TEST completion-20260928] 영등포구 대면 삭제 검증",
        "description": "영등포구 대면 서비스 지역 필터와 삭제를 확인합니다.",
        "mode": "onsite", "regionName": "영등포구", "priceFrom": 50000}, expert)
    sid = service["id"]
    gangnam = call("GET", "/services?regions=강남구&includeRemote=false&limit=50")["items"]
    assert all(x["id"] != sid for x in gangnam)
    yeongdeungpo = call("GET", "/services?regions=영등포구&includeRemote=false&limit=50")["items"]
    assert any(x["id"] == sid for x in yeongdeungpo)
    assert call("GET", "/services?regions=강남구&includeRemote=true&q=completion-20260928")["items"] == []
    room2 = call("POST", f"/services/{sid}/inquiries", {}, consumer)["chatRoomId"]
    expect_status("DELETE", f"/services/{sid}", token=consumer, status=403)
    call("DELETE", f"/services/{sid}", token=expert)
    expect_status("GET", f"/services/{sid}", status=404)
    assert call("GET", f"/chat/rooms/{room2}", token=consumer)["id"] == room2

    quote = call("POST", "/quote-requests", {"categoryCode": "design_development",
        "title": "[TEST completion-20260928] 수정 삭제 견적",
        "description": "마감된 견적도 수정하고 삭제할 수 있는지 테스트합니다.",
        "mode": "remote", "budgetMax": 90000}, consumer)
    qid = quote["id"]
    call("POST", f"/quote-requests/{qid}/close", {}, consumer)
    changed = call("PUT", f"/quote-requests/{qid}", {"categoryCode": "design_development",
        "title": "[TEST completion-20260928] 수정된 견적",
        "description": "마감 후에도 소유자는 견적 내용을 수정할 수 있습니다.",
        "mode": "remote", "budgetMax": 95000}, consumer)
    assert changed["status"] == "closed" and changed["budgetMax"] == 95000
    call("DELETE", f"/quote-requests/{qid}", token=consumer)
    expect_status("GET", f"/quote-requests/{qid}", status=404)
    print("PASS: bilateral completion, review, region filter, soft delete and chat retention")


if __name__ == "__main__":
    main()
