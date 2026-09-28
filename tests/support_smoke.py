"""Support intake and private-list authorization regression."""

import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen


BASE = os.getenv("SUPPORT_TEST_BASE", "http://127.0.0.1:18081/api/v1")


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


def login(role):
    status, result = call("POST", "/auth/test-login", body={
        "ci": f"TEST-CI-KIMGOSU-{role}-048"})
    assert status == 200, (status, result)
    return result["accessToken"]


def main():
    consumer, expert = login("CONSUMER"), login("EXPERT")
    assert call("POST", "/support/tickets", body={
        "title": "무토큰", "body": "로그인 없이 문의할 수 없어야 합니다."})[0] == 401
    for token, title in [(consumer, "일반 이용 문의"), (expert, "고수 서비스 문의")]:
        status, ticket = call("POST", "/support/tickets", token, {
            "title": title, "body": "테스트 계정으로 고객센터 접수와 격리를 확인합니다."})
        assert status == 201, (status, ticket)
        assert ticket["title"] == title and ticket["status"] == "open"
        assert call("GET", f"/support/tickets/{ticket['id']}", token)[0] == 200
        other = expert if token == consumer else consumer
        assert call("GET", f"/support/tickets/{ticket['id']}", other)[0] == 404
        assert ticket["id"] in {row["id"] for row in call("GET", "/support/tickets", token)[1]["items"]}
        assert ticket["id"] not in {row["id"] for row in call("GET", "/support/tickets", other)[1]["items"]}
        first = call("GET", "/support/tickets?limit=1", token)[1]
        assert len(first["items"]) == 1
        assert call("GET", f"/support/tickets?limit=1&cursor={ticket['id']}", other)[0] == 404
    for index in range(20):
        status, _ = call("POST", "/support/tickets", consumer, {
            "title": f"페이지 확인 {index:02d}",
            "body": "여러 페이지의 접수 내역이 빠짐없이 이어지는지 확인합니다."})
        assert status == 201
    first = call("GET", "/support/tickets?limit=20", consumer)[1]
    assert len(first["items"]) == 20 and first["nextCursor"]
    second = call("GET", f"/support/tickets?limit=20&cursor={first['nextCursor']}", consumer)[1]
    assert second["items"] and not ({row["id"] for row in first["items"]} &
                                    {row["id"] for row in second["items"]})
    assert call("GET", f"/support/tickets?cursor={first['nextCursor']}", expert)[0] == 404
    assert call("POST", "/support/tickets", consumer, {
        "title": "  ", "body": "           "})[0] == 422
    print("PASS: consumer/expert support intake, pagination, validation and account isolation")


if __name__ == "__main__":
    main()
