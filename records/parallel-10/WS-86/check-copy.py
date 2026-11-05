#!/usr/bin/env python3
"""design/report-block/screens.md 의 키→문구를 AOS·iOS 소스와 대조한다.

- spec 키 집합과 두 앱의 키 집합이 같은지
- 각 키의 문자열이 정본과 완전히 같은지
- 두 앱에 정본/허용 목록 밖의 한글 UI 문구가 없는지

실행: python3 records/parallel-10/WS-86/check-copy.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
SPEC = ROOT.parent / "kimgosu/design/report-block/screens.md"
KOTLIN = ROOT / "apps/android/app/src/main/java/ai/mintech/kimgosu/customer/ReportBlockScreen.kt"
SWIFT = ROOT / "apps/ios/Kimgosu/ReportBlockView.swift"

# 서버 계약(길이/허용문자)이 없어 쓰지 않는 키. spec.md §4·§7 G2.
# BACK 은 D2 기존 뒤로가기 레이블(다른 화면 소유), TARGET_A11Y 는 함수로 구현한다.
UNUSED_BY_DESIGN = {"REASON_TOO_LONG", "REASON_INVALID", "BACK", "TARGET_A11Y"}
# 화면 문구가 아니라 조립 템플릿/기존 D2 문구/옵션 진입 레이블.
ALLOWED_EXTRA = {"대상: $subject", "대상: \\(subject)", "삭제된 메시지", "더보기"}


def spec_strings():
    rows = {}
    for line in SPEC.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\|\s*([A-Z][A-Z0-9_]+)\s*\|\s*\"(.*)\"\s*\|", line)
        if m:
            rows[m.group(1)] = m.group(2)
    return rows


def camel(key):
    if "_" not in key:
        return key.lower() if key.isupper() else key
    parts = key.split("_")
    return parts[0].lower() + "".join(p.capitalize() for p in parts[1:])


def kotlin_consts():
    text = KOTLIN.read_text(encoding="utf-8")
    return dict(re.findall(r'const val ([A-Z][A-Z0-9_]+) = "(.*)"', text))


def swift_consts():
    text = SWIFT.read_text(encoding="utf-8")
    found = {}
    for name, value in re.findall(r'static let ([a-zA-Z0-9]+) = "(.*)"', text):
        found[name] = value
    return {camel(key): value for key, value in found.items()}


def korean_literals(path):
    text = path.read_text(encoding="utf-8")
    return set(re.findall(r'"([^"\\\n]*[가-힣][^"\\\n]*)"', text))


def main():
    spec = spec_strings()
    if not spec:
        print(f"FAIL: no strings parsed from {SPEC}")
        return 1
    problems = []

    kotlin = kotlin_consts()
    swift = swift_consts()

    expected = {k for k in spec if k not in UNUSED_BY_DESIGN}
    missing_kotlin = expected - set(kotlin)
    missing_swift = {camel(k) for k in expected} - set(swift)
    if missing_kotlin:
        problems.append(f"Kotlin missing keys: {sorted(missing_kotlin)}")
    if missing_swift:
        problems.append(f"Swift missing keys: {sorted(missing_swift)}")

    for key in sorted(expected):
        if key in kotlin and kotlin[key] != spec[key]:
            problems.append(f"Kotlin {key} mismatch: {kotlin[key]!r} != {spec[key]!r}")
        name = camel(key)
        if name in swift and swift[name] != spec[key]:
            problems.append(f"Swift {name} mismatch: {swift[name]!r} != {spec[key]!r}")

    for path in (KOTLIN, SWIFT):
        if "targetA11y" not in path.read_text(encoding="utf-8"):
            problems.append(f"{path.name} has no targetA11y template")

    allowed = set(spec.values()) | ALLOWED_EXTRA
    for path in (KOTLIN, SWIFT):
        extra = {s for s in korean_literals(path) if s not in allowed}
        if extra:
            problems.append(f"{path.name} has copy outside screens.md: {sorted(extra)}")

    if problems:
        print("FAIL")
        for problem in problems:
            print(" -", problem)
        return 1

    print(f"PASS: {len(expected)} keys x 2 apps, {len(spec) - len(expected)} keys unused by design")
    return 0


if __name__ == "__main__":
    sys.exit(main())
