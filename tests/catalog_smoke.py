"""Verify the ordered category code contract used by the home carousel."""

import json
import os
from urllib.request import urlopen


def main():
    base = os.getenv("CATALOG_TEST_BASE", "http://127.0.0.1:8080")
    with urlopen(f"{base}/api/v1/catalog/home-categories", timeout=10) as response:
        categories = json.load(response)
    assert [item["code"] for item in categories] == [
        "design_development", "video_editing", "translation", "legal",
        "cleaning_interior", "pets", "hair_beauty",
    ]
    assert [item["displayOrder"] for item in categories] == [10, 20, 30, 40, 50, 60, 70]
    assert all(item["displayName"] != "기타" and item["iconKey"] for item in categories)
    print("PASS: public ordered home category codes")


if __name__ == "__main__":
    main()
