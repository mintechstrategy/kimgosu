"""Exercise synthetic CI login, allocated PK, profile API and public-route block."""

import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen


BASE = f"http://{os.getenv('LAN_TEST_HOST', '127.0.0.1')}:{os.getenv('LAN_TEST_PORT', '18081')}/api/v1"
PUBLIC = f"http://127.0.0.1:{os.getenv('HTTP_PORT', '8080')}/api/v1"


def call(method, url, data=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data is not None else None
    request = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=10) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, error.read()


def main():
    ci = "TEST-CI-KIMGOSU-CONSUMER-001"
    status, result = call("POST", f"{BASE}/auth/test-login", {"ci": ci})
    assert status == 200, result
    first_id = result["customer"]["userId"]
    assert first_id.startswith("test_")
    assert result["customer"]["customerName"] == "테스트 일반 1"
    assert result["customer"]["birthDate"] == "1991-01-15"
    assert result["customer"]["expertEnabled"] is False
    assert ci not in json.dumps(result)
    token = result["accessToken"]

    status, profile = call("GET", f"{BASE}/customers/me", token=token)
    assert status == 200 and profile["userId"] == first_id
    status, changed = call("PATCH", f"{BASE}/customers/me",
                           {"homeAddress": "테스트 변경 주소"}, token)
    assert status == 200 and changed["homeAddress"] == "테스트 변경 주소"
    status, repeated = call("POST", f"{BASE}/auth/test-login", {"ci": ci})
    assert status == 200 and repeated["customer"]["userId"] == first_id

    status, expert = call("POST", f"{BASE}/auth/test-login",
                          {"ci": "TEST-CI-KIMGOSU-EXPERT-001"})
    assert status == 200 and expert["customer"]["expertEnabled"] is True
    assert expert["customer"]["userId"] != first_id
    assert call("POST", f"{BASE}/auth/test-login", {"ci": "unknown"})[0] == 401
    assert call("GET", f"{BASE}/customers/me")[0] == 401
    assert call("POST", f"{PUBLIC}/auth/test-login", {"ci": ci})[0] == 404
    assert call("GET", f"{PUBLIC}/customers/me", token=token)[0] == 404

    status, _ = call("GET", f"{BASE}/chat/rooms", token=token)
    assert status == 200
    print("PASS: synthetic CI login, stable allocated ID, profile API, chat JWT, public block")


if __name__ == "__main__":
    main()
