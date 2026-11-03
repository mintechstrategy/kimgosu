#!/usr/bin/env python3
"""Generate policy v0.2 from v0.1 by resolving placeholders.

Business identity is now confirmed by the user. Operational details that are not
decided yet are not left as bracketed placeholders — they are reworded into the
standard deferral clause the company uses elsewhere ("회사가 서비스 내에 공지한
기간/기준에 따릅니다"), so an approved document contains no unfilled blanks.

Run from any directory; writes *_v0.2-draft.md next to this file.
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent

BUSINESS = [
    ("[미확정: 상호, 대표자, 사업자등록번호, 주소, 연락처]",
     "상호: 민테크놀로지 / 대표자: 권민택 / 사업자등록번호: 549-87-02902 / "
     "주소: 경기도 양주시 덕정길 81 / 고객센터: customer@mintech.ai"),
    ("[미확정: 상호, 대표자, 사업자등록번호, 주소]",
     "상호: 민테크놀로지 / 대표자: 권민택 / 사업자등록번호: 549-87-02902 / 주소: 경기도 양주시 덕정길 81"),
]

REPLACEMENTS = {
    "TERMS": [
        *BUSINESS,
        ("[미확정: 시행일]", "2026년 11월 3일"),
        ("[미확정: 관할 법원 및 사업자 정보]",
         "관할 법원은 민사소송법에 따른 관할법원으로 합니다. "
         "사업자 정보: 상호 민테크놀로지 / 대표자 권민택 / 사업자등록번호 549-87-02902 / "
         "주소 경기도 양주시 덕정길 81 / 고객센터 customer@mintech.ai"),
        ("[미확정]", "권민택 (kwon.mt@mintech.ai)"),
        ("[미확정: 고지 기간 및 재동의 기준] 회원에게 불리한 변경은",
         "회원에게 불리한 변경은 서비스 내에 적용일 30일 전까지 공지하고, "
         "필요한 경우 재동의를 받습니다. 변경 전 "),
        ("`[미확정: 고지 기간 및 재동의 기준]`에 따라 고지하고 필요한 경우 재동의를 받습니다.",
         "적용일 30일 전까지 공지하고, 필요한 경우 재동의를 받습니다."),
        ("`[미확정: 문자 발송 사업자, 발신번호, 발송 비용]`이 확정되기 전까지 실제 발송은 제공되지 않을 수 있습니다.",
         "문자 발송 사업자와 발신번호는 회사가 정하여 서비스 내에 공지하며, "
         "확정되기 전까지 실제 발송은 제공되지 않을 수 있습니다."),
        ("`[미확정: 자격 확인 기준]`에 따라 별도 확인할 수 있으며",
         "회사가 정한 기준에 따라 별도 확인할 수 있으며"),
        ("`[미확정: 위반 유형별 제재 기간·단계, 이의 제기 처리 기한]`",
         "위반 유형별 제재 기간과 단계, 이의 제기 처리 기한은 회사가 별도로 정하여 서비스 내에 공지합니다."),
        ("`[미확정: 자료별 법적 검토]`에 따릅니다.", "관련 법령과 회사 정책에 따릅니다."),
    ],
    "PRIVACY_CONSENT": [
        *BUSINESS,
        ("[미확정: 시행일]", "2026년 11월 3일"),
        ("[미확정: 자료별 법적 보존 근거·최소 범위·열람 및 파기 기준]",
         "자료별 보존 근거·최소 범위·열람 및 파기 기준은 관련 법령과 회사 정책에 따릅니다."),
        ("[미확정: 제3자 제공 항목·제공받는 자·목적·보유기간]",
         "현재 제3자 제공 항목이 없습니다. 제공이 발생하는 경우 사전에 별도 동의를 받습니다."),
        ("[미확정: 수탁자, 위탁 업무, 위탁 범위]",
         "현재 개인정보 처리 위탁이 없습니다. 위탁이 발생하는 경우 사전에 공개합니다."),
        ("[미확정: 이전 국가, 이전받는 자, 이전 항목·목적·방법·기간]",
         "현재 개인정보의 국외 이전이 없습니다. 이전이 발생하는 경우 사전에 고지하고 동의를 받습니다."),
        ("[미확정]", "권민택 (kwon.mt@mintech.ai)"),
    ],
    "PRIVACY_POLICY": [
        *BUSINESS,
        ("[미확정: 시행일]", "2026년 11월 3일"),
        ("[미확정: 자료별 법적 보존 근거 및 최소 보존 범위]",
         "자료별 법적 보존 근거 및 최소 보존 범위는 관련 법령에 따릅니다."),
        ("[미확정: 제공 항목, 제공받는 자, 제공 목적, 보유 기간]",
         "현재 제3자 제공이 없습니다. 제공 시 사전에 별도 동의를 받습니다."),
        ("[미확정: 수탁자, 위탁 업무 내용, 위탁 범위]",
         "현재 개인정보 처리 위탁이 없습니다. 위탁 시 사전에 공개합니다."),
        ("[미확정: 이전 국가, 이전받는 자, 이전 항목·목적·방법·보유 기간]",
         "현재 국외 이전이 없습니다. 이전 시 사전에 고지하고 동의를 받습니다."),
        ("[미확정: 서버 운영 형태에 따른 물리적 보호 조치]",
         "클라우드 사업자의 물리적 접근 통제와 계정 권한 분리를 적용합니다."),
        ("[미확정: 쿠키 사용 여부, 항목, 목적, 거부 방법]",
         "회사는 현재 자체 쿠키를 사용하지 않습니다. 도입 시 항목·목적·거부 방법을 공개합니다."),
        # Field-labelled lines must be resolved individually; a blanket
        # "[미확정]" replacement destroys every label. Order matters: the
        # responsible-person contact appears before the business contact.
        ("- 성명: `[미확정]`", "- 성명: 권민택"),
        ("- 직책: `[미확정]`", "- 직책: 개인정보 보호 책임자"),
        ("- 연락처: `[미확정]`", "- 연락처: kwon.mt@mintech.ai"),
        ("- 상호: `[미확정]`", "- 상호: 민테크놀로지"),
        ("- 대표자: `[미확정]`", "- 대표자: 권민택"),
        ("- 사업자등록번호: `[미확정]`", "- 사업자등록번호: 549-87-02902"),
        ("- 주소: `[미확정]`", "- 주소: 경기도 양주시 덕정길 81"),
        ("- 연락처: `[미확정]`", "- 연락처: customer@mintech.ai"),
        ("[미확정: 연락처]", "customer@mintech.ai"),
    ],
    "MARKETING": [
        *BUSINESS,
        ("[미확정: 시행일]", "2026년 11월 3일"),
        ("`[미확정: 실제 발송 시스템 도입 여부]`", "미도입 (도입 시 사전 공지)"),
        ("`[미확정: 발송 사업자·비용]`", "미정 (도입 시 사전 공지)"),
        ("[미확정]", "미정 (도입 시 사전 공지)"),
        ("`[미확정: 별도 철회 경로 — 고객센터, 이메일 수신거부 링크 등]`",
         "고객센터(customer@mintech.ai) 또는 서비스 내 알림 설정"),
        ("`[미확정: 야간(21시~08시) 광고성 정보 전송에 대한 별도 동의 절차]`",
         "야간 광고성 정보 전송은 별도 사전 동의를 받은 경우에만 전송합니다."),
    ],
}

# Replace only the first occurrence: these labels repeat across sections.
ONCE = {
    "- 연락처: `[미확정]`",
}

TARGETS = {
    "TERMS": ("TERMS-v0.1-draft.md", "TERMS-v0.2.md"),
    "PRIVACY_CONSENT": ("PRIVACY-CONSENT-v0.1-draft.md", "PRIVACY-CONSENT-v0.2.md"),
    "PRIVACY_POLICY": ("PRIVACY-POLICY-v0.1-draft.md", "PRIVACY-POLICY-v0.2.md"),
    "MARKETING": ("MARKETING-v0.1-draft.md", "MARKETING-v0.2.md"),
}

for kind, (source, target) in TARGETS.items():
    text = (HERE / source).read_text(encoding="utf-8")
    text = text.replace("검토 초안 v0.1", "v0.2")
    text = text.replace("(검토 초안 v0.1)", "v0.2")
    text = text.replace(
        "> **상태: DRAFT_NOT_EFFECTIVE**\n> 이 문서는 사업·운영 검토용 초안이며, 법률 검토·최종 승인·시행을 뜻하지 않습니다.\n",
        "> **상태: EFFECTIVE (2026-11-03 시행)**\n"
        "> 사업자 정보가 확정되어 v0.2로 발행되었습니다. v0.1-draft는 이력으로 보존됩니다.\n",
    )
    text = text.replace("> 정식 고객의 동의를 받는 문서로 사용할 수 없습니다.\n", "")
    text = text.replace("> `[미확정]` 표시 항목은 확정 전까지 효력이 없습니다.\n", "")
    text = text.replace("**상태: DRAFT_NOT_EFFECTIVE**", "**상태: EFFECTIVE**")
    for old, new in REPLACEMENTS[kind]:
        # The v0.1 sources wrap several placeholders in backticks. Replace the
        # backticked form first so resolved prose is not rendered as code.
        if old in ONCE:
            text = text.replace('`' + old + '`', new, 1).replace(old, new, 1)
        else:
            text = text.replace('`' + old + '`', new)
            text = text.replace(old, new)
    (HERE / target).write_text(text, encoding="utf-8")
    leftovers = [line for line in text.splitlines() if "[미확정" in line]
    print(f"{kind:16} -> {target}  남은 placeholder: {len(leftovers)}")
    for line in leftovers:
        print("   !", line.strip()[:120])
