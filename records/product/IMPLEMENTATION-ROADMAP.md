# 김고수 전체 화면·기능 구현 순서 v0.1

- 상태: 정책검토/구현 로드맵 초안. 구현 완료 목록이 아니다. 우선순위1은 회원가입·로그인·회원관리/서비스 이용정책이다.
- 정본 입력: full-design-v0.2-brand-final catalog/stories/SCREEN-INVENTORY 및 최신 사용자 결정. 원본140뷰(iOS111/관리자29)는 페이지·시트·모달·상태 합계이며 독립 페이지140개가 아니다. 앱111뷰는 AOS/iOS에 대응 기능으로 구현한다.
- 첫 정책 결정: product/MEMBERSHIP-SERVICE-POLICY.md. 이름·이메일 필수/성별·연령대 미수집/고수 즉시활성/탈퇴30일후 새고객번호·이전이력미복원/유효제재승계/거래상대방보호·탈퇴확정부터1년보존/운영문서초안을 반영한다. 자료별 보존의 법적 정합성/접근권한·기간예외와 SMS제공사/비용은 별도 검토한다.
- 원본 밖의 필요한 표면은 별도: 내장스플래시 및 다음빌드3초, 서비스운영정책 열람, 동의내역/철회, 변경정책 재동의. 기존문서뷰 재사용 또는 새로운상태 추가를 uiux가 명세하며 원본140에 몰래 합산하지 않는다.
- 공통 순서: 정책/범위→uiux 디자인·Compose/SwiftUI(관리자는Vue) 퍼블리싱→인계 수용→project-lead 앱/API/DB 통합→양 앱 실제 거래/DB·필요R2 재조회→uiux 정책/화면·동등성 QA→수정/재QA→동일 소스 최종빌드. 현행 권한 안에서 AOS만 게시하며 iOS IPA/ZIP은 미게시.
- 아래 순서는 기본 통합 순서다. 선행은 실제 데이터/권한 의존성이다. 02의 사진은03, 04의 실제 게시자료는05/06에 연결하므로 해당 분기만 기다리며 닉네임/목록 입력·동등성 계약을 중복 구현하지 않는다. 공통 파일·migration·무거운빌드·기기 제어는 직렬화한다.
- DB/API는 필요한 엔터티/행위의 계획이다. 실제 생성이나 이미 존재하는 API라는 뜻이 아니다. 각 묶음 착수시에 현행 개발 DB·소스/배포를 확인하고 필요한 추가만 적용한다. 전체 미래 테이블을 일괄 만들지 않는다.
- 전체목록 작성은 모든 단계/50개 자식의 즉시 실행·추가 비용·운영 배포 허가가 아니다. 기존 kimgosu-rebuild 카드/그래프를 재사용한다.

## 01. 회원가입·로그인·회원관리/서비스 이용정책

- 개발/통합: project-lead. 디자인·퍼블리싱/실제 구현 QA: uiux. 상태: 정책 초안·잔여 결정 검토; 제품 미구현.
- 선행: 기존 기획/사용자 정책 결정 및 실제 연동 준비. 기존 원본뷰 23개.
- 세부 기능:
  - KG-F01-01: 카카오·네이버·Google 각각 신규/기존회원 인증, 취소/실패/재진입 및 원래 화면 복귀
  - KG-F01-02: 만14세 이상 확인·약관/개인정보 동의, 정책 전문/버전/시행일 조회, 필수/선택 동의 분리·철회·필요 재동의
  - KG-F01-03: SMS 발송·5자리/60초·재발송 이전코드 폐기·오입력/만료/중복번호·시도제한; 실제 공급자/비용 승인은 별도
  - KG-F01-04: 이름/이메일 필수, 성별/연령대 미수집, 자동 닉네임, 새 고객번호 발급
  - KG-F01-05: 세션 검증/갱신·로그아웃·만료/제한 상태, 계정 연결은 명시적 소유 확인 후만 허용
  - KG-F01-06: 탈퇴시 접근 종료, 재가입시 새 고객번호와 과거 이용 분리, 과거자료 보존 목적/기간·권한은 확정 후 적용
  - KG-F01-07: 서비스 이용정책 문서뿐 아니라 회원/고수·비회원·제한 상태별 서버 접근권한 적용 및 감사
- DB/API 계획: 회원 이용단위/고객번호, 소셜 식별 연결, 세션, 가입시도/SMS challenge, 정책 문서·버전, 동의·철회·상태 이력. 실제 테이블명/컬럼/제약은 확정 정책과 현행 개발 DB 대조 후 정한다.
- 실제 거래/QA: 각 앱 가입→실제 DB 저장→회원·동의 재조회→로그인/세션갱신→로그아웃 후 접근 거부. 중복/미동의/선택미동의/계정연결충돌/타인ID/탈퇴·재가입 격리도 검증. 실제 소셜/SMS와 시험 인증을 구분.
- 미정/경계: 확정된30일/새고객번호/제재승계·1년기산은 유지하고, 자료별 보존/제재 세부·법적 예외, SMS 공급자/발송비용, 실제 소셜 설정과 검토 정책 전문은 구별한다. UIUX 퍼블리싱 인계 전 앱 통합 미착수.
- 원본 화면/상태 매핑:
  - E1 — 로그인·가입 / page / 원본p16 / ios / UI: html/E1.html
  - E2_TERMS — 약관 동의 / page / 원본p17 / ios / UI: html/E2_TERMS.html
  - E2_SMS — SMS 인증 / page / 원본p18 / ios / UI: html/E2_SMS.html
  - ACCOUNT_LINK — 소셜 계정 연결 확인 / sheet / 원본p40 / ios / UI: html/ACCOUNT_LINK.html
  - ACCOUNT_CONFLICT — 이미 연결된 계정 충돌 / state / 원본p41 / ios / UI: html/ACCOUNT_CONFLICT.html
  - LOGIN_FAILURE — 소셜 로그인 취소·실패 / state / 원본p42 / ios / UI: html/LOGIN_FAILURE.html
  - SESSION_EXPIRED — 로그인 만료·재인증 / modal / 원본p43 / ios / UI: html/SESSION_EXPIRED.html
  - ACCOUNT_RESTRICTED — 이용 제한 계정 / state / 원본p44 / ios / UI: html/ACCOUNT_RESTRICTED.html
  - TERMS_DOC — 이용약관 전문 표면·본문 의존성 / page / 원본p86 / ios / UI: html/TERMS_DOC.html
  - PRIVACY_DOC — 개인정보 처리방침 전문 표면 / page / 원본p87 / ios / UI: html/PRIVACY_DOC.html
  - MARKETING_DOC — 마케팅 수신 동의문 전문 표면 / page / 원본p88 / ios / UI: html/MARKETING_DOC.html
  - LEGAL_ERROR — 문서 로드 실패·동의 차단 / state / 원본p89 / ios / UI: html/LEGAL_ERROR.html
  - SMS_SENT — SMS 발송 후·5자리·60초 / state / 원본p117 / ios / UI: html/SMS_SENT.html
  - SMS_EXPIRED — SMS 만료·재전송 / state / 원본p118 / ios / UI: html/SMS_EXPIRED.html
  - SMS_INVALID — SMS 인증번호 불일치 / state / 원본p119 / ios / UI: html/SMS_INVALID.html
  - SMS_DUPLICATE — 이미 인증된 전화번호 / state / 원본p120 / ios / UI: html/SMS_DUPLICATE.html
  - SMS_SEND_ERROR — SMS 발송 실패·번호 유지 / state / 원본p121 / ios / UI: html/SMS_SEND_ERROR.html
  - F1 — 마이페이지 / page / 원본p19 / ios / UI: html/F1.html
  - F4_NOTI — 알림 설정 / page / 원본p24 / ios / UI: html/F4_NOTI.html
  - F5 — 회원 탈퇴 / page / 원본p25 / ios / UI: html/F5.html
  - WITHDRAW_CONFIRM — 탈퇴 영향·최종 확인 / modal / 원본p83 / ios / UI: html/WITHDRAW_CONFIRM.html
  - WITHDRAW_ERROR — 탈퇴 실패·계정 유지 / state / 원본p84 / ios / UI: html/WITHDRAW_ERROR.html
  - HOME_SIGNED_OUT — 탈퇴 후 비회원 홈 복귀 / state / 원본p85 / ios / UI: html/HOME_SIGNED_OUT.html

## 02. 프로필·고수 전환·자격/상태

- 개발/통합: project-lead. 디자인·퍼블리싱/실제 구현 QA: uiux. 상태: backlog; 미착수.
- 선행: 01. 기존 원본뷰 9개.
- 세부 기능:
  - KG-F02-01: 프로필·닉네임 조회/수정/경계검증·취소/저장실패 초안 유지
  - KG-F02-02: 필수정보 입력·고수 신청 후 즉시 활성화; 관리자 사전승인 강제하지 않음
  - KG-F02-03: 일반/고수 모드 전환과 서버 역할·자격검증 분리
  - KG-F02-04: 자격필요 분야 확인·이용제한/보완 상태; 심사 대기/거절뷰는 원본 보존하되 일반 고수의 필수 경로로 자동 활성화하지 않음
  - KG-F02-05: 프로필 사진은03 공통 미디어 연결 후 실제 업로드/재조회
- DB/API 계획: 회원 프로필, 고수 신청/권한·자격분야 상태, 변경이력.
- 실제 거래/QA: 두 앱 프로필 변경 DB 재조회·권한전환과 타인수정/제한우회 거부, 사진은R2객체/권한까지 대조.
- 미정/경계: 자격분야 기준과 제재; 사진 분기만03 선행.
- 원본 화면/상태 매핑:
  - F1G — 고수 모드 / page / 원본p27 / ios / UI: html/F1G.html
  - EXPERT_ACTIVATE — 고수 시작 안내 / page / 원본p47 / ios / UI: html/EXPERT_ACTIVATE.html
  - EXPERT_PENDING — 고수 심사 대기·정책 제안 / state / 원본p48 / ios / UI: html/EXPERT_PENDING.html
  - EXPERT_REJECTED — 고수 보완 요청·정책 제안 / state / 원본p49 / ios / UI: html/EXPERT_REJECTED.html
  - EXPERT_SUSPENDED — 고수 이용 제한 / state / 원본p50 / ios / UI: html/EXPERT_SUSPENDED.html
  - PROFILE_EDIT — 프로필 사진·닉네임 수정 / page / 원본p98 / ios / UI: html/PROFILE_EDIT.html
  - PROFILE_INVALID — 닉네임 입력 검증 / state / 원본p99 / ios / UI: html/PROFILE_INVALID.html
  - PROFILE_SAVE_ERROR — 프로필 저장 실패·초안 유지 / state / 원본p100 / ios / UI: html/PROFILE_SAVE_ERROR.html
  - PROFILE_SAVED — 동일 프로필 저장 후 재조회·설계 예시 / state / 원본p101 / ios / UI: html/PROFILE_SAVED.html

## 03. 사진·영상·파일 공통 처리

- 개발/통합: project-lead. 디자인·퍼블리싱/실제 구현 QA: uiux. 상태: backlog; 미착수.
- 선행: 01. 기존 원본뷰 8개.
- 세부 기능:
  - KG-F03-01: 사진 선택/권한거부·가로세로 원비율·방향 보정·메타데이터 최소화
  - KG-F03-02: 이미지 최적화본·썸네일 저장, 순서/개별삭제/최대개수 상태
  - KG-F03-03: 공개 포트폴리오와 비공개 채팅 첨부의 저장·다운로드 권한 분리
  - KG-F03-04: 업로드 진행/중단/재시도·처리중/실패·미완료 임시객체 정리
  - KG-F03-05: 영상 변환·썸네일·재생은 실제 규격/기능/비용 확정 후 같은 공통경계에 추가; 유료 서비스 자동 도입 없음
- DB/API 계획: 미디어 소유자/용도/권한·처리상태·최적화 결과 및 R2 객체참조.
- 실제 거래/QA: 양 앱 업로드→실제R2 저장→API/이미지 재조회, 비공개 타인접근 거부·실패객체 정리.
- 미정/경계: 사진/영상 형식·용량/길이·임시보관기간·변환비용 승인. 스플래시 자산은계속앱내장이며웹/R2업로드대상아님.
- 원본 화면/상태 매핑:
  - PERMISSION_PHOTOS — 사진 권한 거절 안내 / modal / 원본p62 / ios / UI: html/PERMISSION_PHOTOS.html
  - PHOTO_REORDER — 폼 사진 개별 삭제·순서 유지 / state / 원본p122 / ios / UI: html/PHOTO_REORDER.html
  - PHOTOS_MAX — 사진 최대5장 상태 / state / 원본p123 / ios / UI: html/PHOTOS_MAX.html
  - PHOTO_VIEWER — 채팅 사진 확대·원비율 / page / 원본p52 / ios / UI: html/PHOTO_VIEWER.html
  - VIDEO_UPLOAD — 영상 업로드 진행 / state / 원본p56 / ios / UI: html/VIDEO_UPLOAD.html
  - VIDEO_PROCESSING — 영상 변환·처리중 / state / 원본p57 / ios / UI: html/VIDEO_PROCESSING.html
  - VIDEO_ERROR — 영상 처리 실패·재시도 / state / 원본p58 / ios / UI: html/VIDEO_ERROR.html
  - VIDEO_READY — 영상 재생 가능 / page / 원본p59 / ios / UI: html/VIDEO_READY.html

## 04. 지역·메인 데이터·검색·목록·찜

- 개발/통합: project-lead. 디자인·퍼블리싱/실제 구현 QA: uiux. 상태: backlog; 미착수.
- 선행: 01. 기존 원본뷰 17개.
- 세부 기능:
  - KG-F04-01: 기존A1 표현 유지, 실제 지역/분야/최근·인기 서비스 데이터 연결
  - KG-F04-02: 수동 지역/비대면·위치권한 거부 대안·탐색지역 변경
  - KG-F04-03: 검색·최근검색·연관카테고리·불일치, 결과/로딩/빈목록/실패 구분
  - KG-F04-04: 서비스/견적 목록 정렬·필터·페이지·복귀 시 조건/스크롤 보존
  - KG-F04-05: 서비스 찜/해제·중복요청·삭제대상 제외와 로그인 복귀
- DB/API 계획: 지역/분류의 실제 기준코드·서비스 읽기/검색·찜·검색기록, 허용된 집계.
- 실제 거래/QA: 실제 개발DB의 승인 데이터로 필터/정렬/페이지 대조, 양 앱 찜 쓰기→재조회·해제, 오류를 빈목록으로 위장하지 않음.
- 미정/경계: 행정지역/분류 원본과 노출·정렬·기록 보존 기준. 게시 데이터는05/06의 실제 결과와 연결.
- 원본 화면/상태 매핑:
  - A1 — 메인 / page / 원본p1 / ios / UI: html/A1.html
  - A2 — 위치 설정 / page / 원본p2 / ios / UI: html/A2.html
  - ALL_CATEGORIES — 전체 서비스 / page / 원본p3 / ios / UI: html/ALL_CATEGORIES.html
  - A3_SERVICE — 서비스 목록 / page / 원본p4 / ios / UI: html/A3_SERVICE.html
  - A3_QUOTE — 견적 목록 / page / 원본p5 / ios / UI: html/A3_QUOTE.html
  - B1 — 검색 / page / 원본p9 / ios / UI: html/B1.html
  - B2_MATCH — 연관 카테고리 / page / 원본p10 / ios / UI: html/B2_MATCH.html
  - B2_EMPTY — 일치 카테고리 없음 / page / 원본p11 / ios / UI: html/B2_EMPTY.html
  - PERMISSION_LOCATION — 위치 권한 거절·수동 선택 / modal / 원본p61 / ios / UI: html/PERMISSION_LOCATION.html
  - REGION_CHANGE — 탐색지역 변경 / sheet / 원본p64 / ios / UI: html/REGION_CHANGE.html
  - LIST_LOADING — 목록 불러오는 중 / state / 원본p65 / ios / UI: html/LIST_LOADING.html
  - SERVICE_EMPTY — 서비스 목록 없음 / state / 원본p66 / ios / UI: html/SERVICE_EMPTY.html
  - QUOTE_EMPTY — 견적 목록 없음 / state / 원본p67 / ios / UI: html/QUOTE_EMPTY.html
  - LIST_ERROR — 목록 조회 실패·재시도 / state / 원본p69 / ios / UI: html/LIST_ERROR.html
  - SORT_SERVICE — 서비스 원본 정렬 선택 / sheet / 원본p115 / ios / UI: html/SORT_SERVICE.html
  - SORT_QUOTE — 견적 원본 정렬 선택 / sheet / 원본p116 / ios / UI: html/SORT_QUOTE.html
  - F4_FAV — 찜한 전문가 / page / 원본p23 / ios / UI: html/F4_FAV.html

## 05. 고수 공개정보·포트폴리오·서비스 등록/관리

- 개발/통합: project-lead. 디자인·퍼블리싱/실제 구현 QA: uiux. 상태: backlog; 미착수.
- 선행: 01, 02, 03. 기존 원본뷰 18개.
- 세부 기능:
  - KG-F05-01: 고수 공개 프로필·포트폴리오 목록/상세·원비율 미디어
  - KG-F05-02: 본인 포트폴리오 등록/수정·실패/초안 유지
  - KG-F05-03: 서비스 소개·필수 사진/지역·BASIC 필수, PRIME/SUPER 추가 중간상태/최대3개·입력검증
  - KG-F05-04: 유의사항 원본필수/최대500자 보존, 서비스 등록/상세/내 목록/수정
  - KG-F05-05: 삭제확인/비공개/사용불가·실패를 구분하고 과거 상담 문맥과 수정값 분리
  - KG-F05-06: 단일분류/복수지역 공통 입력 컨트롤은 견적에서도 재사용
- DB/API 계획: 서비스·패키지·포트폴리오·공개상태·카테고리/가능지역·미디어 관계.
- 실제 거래/QA: 양 앱 등록/수정→PostgreSQL/R2확인→상세/목록 재조회, 중복저장·타인수정·비공개 접근과 삭제취소/확정 검증.
- 미정/경계: 가격0원/문자계수·자격분야·보존정책/미디어한도. 게시 수정으로 과거 합의/상담이 변하면 안 됨.
- 원본 화면/상태 매핑:
  - A5 — 서비스 상세 / page / 원본p8 / ios / UI: html/A5.html
  - F3 — 서비스 등록 / page / 원본p22 / ios / UI: html/F3.html
  - F2_SERVICE — 나의 서비스 관리 / page / 원본p21 / ios / UI: html/F2_SERVICE.html
  - SERVICE_EDIT — 기존 서비스 수정·분류 잠금 / page / 원본p106 / ios / UI: html/SERVICE_EDIT.html
  - PACKAGES_BASIC — BASIC 필수·추가 패키지 없음 / state / 원본p124 / ios / UI: html/PACKAGES_BASIC.html
  - PACKAGES_PRIME — BASIC·PRIME 2개 패키지 추가 중간 상태 / state / 원본p125 / ios / UI: html/PACKAGES_PRIME.html
  - PACKAGES_FULL — BASIC·PRIME·SUPER 최대3개 / state / 원본p126 / ios / UI: html/PACKAGES_FULL.html
  - PACKAGES_ERROR — 패키지 필수값 오류 / state / 원본p127 / ios / UI: html/PACKAGES_ERROR.html
  - EXPERT_PROFILE — 고수 공개 프로필 / page / 원본p90 / ios / UI: html/EXPERT_PROFILE.html
  - PORTFOLIO_LIST — 고수 작업물 목록 / page / 원본p91 / ios / UI: html/PORTFOLIO_LIST.html
  - PORTFOLIO_DETAIL — 작업물 상세·원비율 / page / 원본p92 / ios / UI: html/PORTFOLIO_DETAIL.html
  - PORTFOLIO_EDIT — 본인 작업물 등록·수정 / page / 원본p93 / ios / UI: html/PORTFOLIO_EDIT.html
  - PORTFOLIO_EDIT_ERROR — 작업물 저장 실패·초안 유지 / state / 원본p94 / ios / UI: html/PORTFOLIO_EDIT_ERROR.html
  - POST_UNAVAILABLE — 삭제·비공개 대상 안내 / state / 원본p108 / ios / UI: html/POST_UNAVAILABLE.html
  - POST_DELETE_CONFIRM — 기존 게시글 삭제 확인·제안 / modal / 원본p109 / ios / UI: html/POST_DELETE_CONFIRM.html
  - POST_SAVE_ERROR — 게시글 수정 저장 실패·초안 유지 / state / 원본p110 / ios / UI: html/POST_SAVE_ERROR.html
  - CATEGORY_PICKER — 단일 카테고리 선택 / sheet / 원본p102 / ios / UI: html/CATEGORY_PICKER.html
  - REGION_PICKER — 폼의 복수 지역 선택 / sheet / 원본p103 / ios / UI: html/REGION_PICKER.html

## 06. 견적 요청·제안 진입·내 견적 관리

- 개발/통합: project-lead. 디자인·퍼블리싱/실제 구현 QA: uiux. 상태: backlog; 미착수.
- 선행: 01, 03, 04, 05. 기존 원본뷰 8개.
- 세부 기능:
  - KG-F06-01: 견적요청 제목/요구/가격범위/희망일·기간/사진/참고URL·지역/분류 입력
  - KG-F06-02: 견적 상세·내 견적 목록/수정, 카테고리 수정제한·초안 유지
  - KG-F06-03: 3/7/14일 원본 모집기간·수동/기간마감·마감된 견적 상태
  - KG-F06-04: 고수 제안 진입의 로그인/카테고리 서비스/마감/자기제안·권한 검사
  - KG-F06-05: 견적 제안은 문맥 채팅 연결이며 예약 확정/결제 성공이 아님
- DB/API 계획: 견적요청·지역/카테고리·마감/변경상태·첨부 및 제안 문맥.
- 실제 거래/QA: 등록/수정/마감→DB 재조회, 서버시각 경계·동시/중복제안·타인ID·마감거부를 두 앱에서 검증.
- 미정/경계: 정확 마감시각·수정 후 재개·합의/스냅샷 세부와 채팅07 연결.
- 원본 화면/상태 매핑:
  - C1 — 견적 등록 / page / 원본p12 / ios / UI: html/C1.html
  - A4 — 견적 상세 / page / 원본p7 / ios / UI: html/A4.html
  - A3_GATE — 제안 진입 안내 / modal / 원본p6 / ios / UI: html/A3_GATE.html
  - F2_QUOTE — 나의 견적 관리 / page / 원본p20 / ios / UI: html/F2_QUOTE.html
  - QUOTE_EDIT — 기존 견적 수정·분류 잠금 / page / 원본p105 / ios / UI: html/QUOTE_EDIT.html
  - QUOTE_CLOSED — 마감된 견적 관리 / state / 원본p107 / ios / UI: html/QUOTE_CLOSED.html
  - FORM_ERROR — 견적 입력 오류·초안 유지 / state / 원본p70 / ios / UI: html/FORM_ERROR.html
  - DATE_PICKER — 희망 작업일 선택 / sheet / 원본p104 / ios / UI: html/DATE_PICKER.html

## 07. 문맥 채팅·실시간 메시지·차단/신고

- 개발/통합: project-lead. 디자인·퍼블리싱/실제 구현 QA: uiux. 상태: backlog; 미착수.
- 선행: 01, 03, 05, 06. 기존 원본뷰 7개.
- 세부 기능:
  - KG-F07-01: 서비스/견적 대상카드·참여자 권한과 기존 방 생성/재사용
  - KG-F07-02: 목록/미읽음·텍스트/사진·파일 송수신과 영속 확인
  - KG-F07-03: 전송중/실패/재전송·멱등·읽음·페이지·정렬·재접속 누락복구
  - KG-F07-04: 대상 삭제/탈퇴·제한·권한 소멸 상태에서 안전한 읽기/쓰기·첨부 접근
  - KG-F07-05: 신고사유/차단확인/차단상태·허용 기록/CS 진입
- DB/API 계획: 문맥 방·참여자·메시지·읽음·멱등키·첨부·신고/차단 관계.
- 실제 거래/QA: 실제 두 회원의 AOS↔iOS 송수신/DB 재조회·재접속·중복전송/읽음/비참여자 차단, 탈퇴/재가입 고객번호 격리.
- 미정/경계: 방 유일성·차단 후 접근·보존기간·제재/CS 정책. mock전송/푸시성공은 메시지영속 성공 아님.
- 원본 화면/상태 매핑:
  - D1 — 채팅 목록 / page / 원본p13 / ios / UI: html/D1.html
  - D2 — 채팅방·전송 실패 / page / 원본p14 / ios / UI: html/D2.html
  - CHAT_EMPTY — 채팅 목록 없음 / state / 원본p68 / ios / UI: html/CHAT_EMPTY.html
  - CHAT_ATTACH — 채팅 첨부 선택 / sheet / 원본p51 / ios / UI: html/CHAT_ATTACH.html
  - CHAT_REPORT — 대화 신고 사유 입력 / sheet / 원본p53 / ios / UI: html/CHAT_REPORT.html
  - CHAT_BLOCK_CONFIRM — 상대방 차단 확인 / modal / 원본p54 / ios / UI: html/CHAT_BLOCK_CONFIRM.html
  - CHAT_BLOCKED — 차단된 대화·안전한 복귀 / state / 원본p55 / ios / UI: html/CHAT_BLOCKED.html

## 08. 거래 자기신고·리뷰·댓글

- 개발/통합: project-lead. 디자인·퍼블리싱/실제 구현 QA: uiux. 상태: backlog; 미착수.
- 선행: 01, 05, 06, 07. 기존 원본뷰 7개.
- 세부 기능:
  - KG-F08-01: 원본 한쪽 거래 자기신고와 리뷰 진입·표시 의미 보존
  - KG-F08-02: 리뷰 작성·별점/선택태그/본문·상세·입력 경계
  - KG-F08-03: 공개 댓글 작성/본인수정/삭제확인/오류·비속어 운영기준
  - KG-F08-04: 중복/자기평가/타인수정/신고 숨김·평점 반영 및 변경이력
- DB/API 계획: 거래 자기신고·리뷰·평점·댓글·운영 조치.
- 실제 거래/QA: 양 앱 작성→DB 저장/상세/평점 재조회, 중복·자기/타인ID·삭제취소·재시도 검증.
- 미정/경계: 반복리뷰단위/자격·신고/평점·비속어기준. 미승인 양측합의/완료 조건이나 검증구매 표시를 추가하지 않음.
- 원본 화면/상태 매핑:
  - D3 — 리뷰 작성 / page / 원본p15 / ios / UI: html/D3.html
  - REVIEW_DETAIL — 리뷰 상세 / page / 원본p34 / ios / UI: html/REVIEW_DETAIL.html
  - TRADE_CONFIRM — 원본 거래 여부 자기신고 / modal / 원본p60 / ios / UI: html/TRADE_CONFIRM.html
  - COMMENT_CREATE — 댓글 작성 / sheet / 원본p111 / ios / UI: html/COMMENT_CREATE.html
  - COMMENT_EDIT — 본인 댓글 수정 / sheet / 원본p112 / ios / UI: html/COMMENT_EDIT.html
  - COMMENT_DELETE_CONFIRM — 본인 댓글 삭제 확인·제안 / modal / 원본p113 / ios / UI: html/COMMENT_DELETE_CONFIRM.html
  - COMMENT_ERROR — 댓글 입력·저장 오류 / state / 원본p114 / ios / UI: html/COMMENT_ERROR.html

## 09. 고수별 고객원장

- 개발/통합: project-lead. 디자인·퍼블리싱/실제 구현 QA: uiux. 상태: backlog; 미착수.
- 선행: 01, 02, 07. 기존 원본뷰 5개.
- 세부 기능:
  - KG-F09-01: 고수별 고객 관계 목록/검색/빈결과·상세
  - KG-F09-02: 자기 원장 메모/태그·상담/거래 문맥 연결
  - KG-F09-03: 수정/실패/초안 보존·관계 제거와 원본 상담기록 분리
  - KG-F09-04: 같은 고객이라도 고수간 원장 완전격리, 외부 미가입고객 자동회원 생성 금지
- DB/API 계획: 고수-고객 관계·사적 메모/태그·허용 상담 링크.
- 실제 거래/QA: 고수A/B와 같은 고객의 실제 CRUD/SQL 재조회·상호접근 거부·동시수정·탈퇴/새고객번호 불승계 검증.
- 미정/경계: 원장 보존/권리·열람정책, 미가입외부고객 여부와 관계삭제기준.
- 원본 화면/상태 매핑:
  - G0 — 고객원장 목록·검색 / page / 원본p35 / ios / UI: html/G0.html
  - G0_EMPTY — 고객원장 검색 결과 없음 / state / 원본p36 / ios / UI: html/G0_EMPTY.html
  - G1 — 고객원장 상세 / page / 원본p28 / ios / UI: html/G1.html
  - G1_EDIT — 고객 메모 수정 / page / 원본p37 / ios / UI: html/G1_EDIT.html
  - G1_EDIT_ERROR — 고객 메모 저장 실패·초안 유지 / state / 원본p38 / ios / UI: html/G1_EDIT_ERROR.html

## 10. 받은 알림·딥링크·고객센터

- 개발/통합: project-lead. 디자인·퍼블리싱/실제 구현 QA: uiux. 상태: backlog; 미착수.
- 선행: 01, 07. 기존 원본뷰 7개.
- 세부 기능:
  - KG-F10-01: 받은 알림 목록/없음·읽음·삭제/권한없는 대상 안내
  - KG-F10-02: 로그인/프로세스 복귀·딥링크 원래 대상 복귀와 타인 목적지 차단
  - KG-F10-03: OS 권한과 채널 설정·마케팅 동의/철회 별도 적용
  - KG-F10-04: 고객센터 입력·실제 접수·중복 방지·실패 초안 유지·답변 경로
- DB/API 계획: 알림 사건/수신자/읽음·기기토큰/선호·지원접수.
- 실제 거래/QA: 실제 사건→알림 DB/목록·읽음 재조회·권한 검증, 문의접수 DB/관리자 재조회. 외부 푸시/메일 실발송은 별도 증거.
- 미정/경계: 알림보존·실제지원주소/응답기준·APNs/FCM/메일/발송권한과비용.
- 원본 화면/상태 매핑:
  - NOTIFICATIONS — 받은 알림 목록 / page / 원본p95 / ios / UI: html/NOTIFICATIONS.html
  - NOTIFICATIONS_EMPTY — 받은 알림 없음 / state / 원본p96 / ios / UI: html/NOTIFICATIONS_EMPTY.html
  - NOTIFICATION_UNAVAILABLE — 알림 대상 삭제·권한 없음 / state / 원본p97 / ios / UI: html/NOTIFICATION_UNAVAILABLE.html
  - PERMISSION_NOTIFICATIONS — 알림 권한 거절 안내 / modal / 원본p63 / ios / UI: html/PERMISSION_NOTIFICATIONS.html
  - F6 — 고객 센터 / page / 원본p26 / ios / UI: html/F6.html
  - CONTACT_SENT — 고객센터 접수 확인·설계 예시 / state / 원본p71 / ios / UI: html/CONTACT_SENT.html
  - CONTACT_ERROR — 고객센터 접수 실패·초안 유지 / state / 원본p72 / ios / UI: html/CONTACT_ERROR.html

## 11. 결제 시연 — 실결제 제외

- 개발/통합: project-lead. 디자인·퍼블리싱/실제 구현 QA: uiux. 상태: backlog; 미착수.
- 선행: 01, 05, 06. 기존 원본뷰 2개.
- 세부 기능:
  - KG-F11-01: 대상/견적 요약→결제 시연→완료 시연·취소/복귀
  - KG-F11-02: 결제 시연·실제 결제 없음 표시
  - KG-F11-03: 금융정보 입력·PG/StoreKit/결제요청/실주문/매출과 분리
- DB/API 계획: 필요한 최소 개발용 시연자료만. 실제 결제/정산 전용 미래 테이블을 만들지 않음.
- 실제 거래/QA: 양 앱 시연동작 전후 실제 결제호출·실주문/매출·리뷰자격·운영지표 생성이 없음을 대조.
- 미정/경계: 공개 출시의 시연 노출/숨김 승인. 실결제는범위밖.
- 원본 화면/상태 매핑:
  - P1 — 결제 시연 / page / 원본p29 / ios / UI: html/P1.html
  - P2 — 결제 시연 완료 / page / 원본p39 / ios / UI: html/P2.html

## 12. 관리자 인증·회원/서비스/포트폴리오·운영 감사

- 개발/통합: project-lead. 디자인·퍼블리싱/실제 구현 QA: uiux. 상태: backlog; 미착수.
- 선행: 01, 02, 05. 기존 원본뷰 13개.
- 세부 기능:
  - KG-F12-01: 관리자 로그인/세션·역할별 권한·민감정보 마스킹
  - KG-F12-02: 회원/고수 상세·상태, 서비스/포트폴리오 작업목록/상세
  - KG-F12-03: 운영조치 사유/대상·영향 확인→저장/실패·동시수정
  - KG-F12-04: 감사/처리이력·재가입 전후 고객번호 연결은 제한된 운영 권한에서만 조회
- DB/API 계획: 관리자 역할·허용행위·콘텐츠조치·감사; 실제 운영계정 생성은 별도권한.
- 실제 거래/QA: 관리자 실제 조회/조치→DB·API재조회, 일반회원/하위역할 거부·감사실패·동시수정 검증.
- 미정/경계: 제재/이의·개인정보 열람 역할과 책임자; 단순 로그인으로 사적 원장/채팅을 열지 않음.
- 원본 화면/상태 매핑:
  - ADM_LOGIN — 관리자 로그인 진입 / page / 원본p45 / admin / UI: html/ADM_LOGIN.html
  - ADM_SESSION — 관리자 세션 만료 / state / 원본p46 / admin / UI: html/ADM_SESSION.html
  - ADM2 — 회원·서비스 관리 / page / 원본p31 / admin / UI: html/ADM2.html
  - ADM_MEMBER_DETAIL — 관리자 회원·고수 상세 / page / 원본p136 / admin / UI: html/ADM_MEMBER_DETAIL.html
  - ADM_SERVICES — 관리자 서비스 작업 목록 / page / 원본p133 / admin / UI: html/ADM_SERVICES.html
  - ADM_PORTFOLIOS — 관리자 포트폴리오 목록 / page / 원본p134 / admin / UI: html/ADM_PORTFOLIOS.html
  - ADM_SERVICE_DETAIL — 관리자 서비스 상세 / page / 원본p137 / admin / UI: html/ADM_SERVICE_DETAIL.html
  - ADM_PORTFOLIO_DETAIL — 관리자 포트폴리오 상세 / page / 원본p138 / admin / UI: html/ADM_PORTFOLIO_DETAIL.html
  - ADM_ACTION_CONFIRM — 관리자 조치 사유·영향 확인 / modal / 원본p73 / admin / UI: html/ADM_ACTION_CONFIRM.html
  - ADM_ACTION_SUCCESS — 운영 조치 결과·설계 예시 / state / 원본p74 / admin / UI: html/ADM_ACTION_SUCCESS.html
  - ADM_ACTION_ERROR — 운영 조치 저장 실패 / state / 원본p75 / admin / UI: html/ADM_ACTION_ERROR.html
  - ADM_AUDIT — 운영 처리 이력 / page / 원본p76 / admin / UI: html/ADM_AUDIT.html
  - ADM_LIST_ERROR — 관리자 목록 조회 실패 / state / 원본p140 / admin / UI: html/ADM_LIST_ERROR.html

## 13. 관리자 CS·제한된 채팅 열람

- 개발/통합: project-lead. 디자인·퍼블리싱/실제 구현 QA: uiux. 상태: backlog; 미착수.
- 선행: 07, 10, 12. 기존 원본뷰 7개.
- 세부 기능:
  - KG-F13-01: CS 작업목록/검색/빈목록·상세·처리상태/메모/이력
  - KG-F13-02: 건·권한·사유·대상·유효시간에 한정한 채팅/첨부 열람
  - KG-F13-03: 거절/만료/감사실패 시내용잠금, 임의 방 연결·무제한 조회 방지
- DB/API 계획: CS 건/배정·열람승인/사유/범위/기간·접근/처리 감사.
- 실제 거래/QA: 실제 접수/처리→DB재조회, 권한·사유·기간·다른방 조합 거부와 감사실패 폐쇄 검증.
- 미정/경계: 열람승인 책임·보존·처리정책; 사용자 대신 메시지 전송 금지.
- 원본 화면/상태 매핑:
  - ADM3 — CS 상세·채팅 잠금 / page / 원본p32 / admin / UI: html/ADM3.html
  - ADM_CS_LIST — 관리자 CS 작업 목록 / page / 원본p135 / admin / UI: html/ADM_CS_LIST.html
  - ADM_CS_EMPTY — 관리자 CS 검색 결과 없음 / state / 원본p139 / admin / UI: html/ADM_CS_EMPTY.html
  - ADM_CS_OPEN — 사유·권한 확인 후 제한 열람 / page / 원본p79 / admin / UI: html/ADM_CS_OPEN.html
  - ADM_CS_DENIED — CS 대화 열람 거절 / state / 원본p80 / admin / UI: html/ADM_CS_DENIED.html
  - ADM_CS_EXPIRED — CS 열람 허가 만료 / state / 원본p81 / admin / UI: html/ADM_CS_EXPIRED.html
  - ADM_CS_AUDIT_ERROR — CS 감사 기록 실패·잠금 / state / 원본p82 / admin / UI: html/ADM_CS_AUDIT_ERROR.html

## 14. 관리자 지역/분류/자산·플랫폼 지표

- 개발/통합: project-lead. 디자인·퍼블리싱/실제 구현 QA: uiux. 상태: backlog; 미착수.
- 선행: 04, 05, 06, 07, 12. 기존 원본뷰 9개.
- 세부 기능:
  - KG-F14-01: 지역코드 계층/수정/참조영향·폐지·동시수정 충돌
  - KG-F14-02: 분류/아이콘 코드목록·수정/중복·사용중 비활성 영향
  - KG-F14-03: 승인 자산의 식별자·비율·정렬/노출 교체
  - KG-F14-04: 회원/고수·DAU/MAU·게시/지역별 지표와 KST기간·테스트/시연 제외
  - KG-F14-05: 지표정의/분모/0건/실패/부분기간 구분, 매출미연동을 견적/시연합계로 위장하지 않음
- DB/API 계획: 기준코드/자산·변경이력, 승인된 최소 활동/집계; 별도 분석플랫폼 자동 도입 없음.
- 실제 거래/QA: 실제 코드/자산 변경·참조 재조회 및 기지 합성자료의 집계 SQL/화면 대조, 과거참조/중복/기간경계·권한 검증.
- 미정/경계: 공식지역코드·운영권한·지표정의·데이터 보존/비식별 기준.
- 원본 화면/상태 매핑:
  - ADM4 — 지역코드 관리 / page / 원본p33 / admin / UI: html/ADM4.html
  - ADM_REGION_EDIT — 지역코드 수정·참조 영향 / page / 원본p77 / admin / UI: html/ADM_REGION_EDIT.html
  - ADM_REGION_CONFLICT — 지역코드 동시 수정 충돌 / state / 원본p78 / admin / UI: html/ADM_REGION_CONFLICT.html
  - ADM_CATEGORY_LIST — 분류·아이콘 코드 목록 / page / 원본p128 / admin / UI: html/ADM_CATEGORY_LIST.html
  - ADM_CATEGORY_EDIT — 분류 코드 상세·수정 / page / 원본p129 / admin / UI: html/ADM_CATEGORY_EDIT.html
  - ADM_CATEGORY_DUPLICATE — 분류 코드 중복 오류 / state / 원본p130 / admin / UI: html/ADM_CATEGORY_DUPLICATE.html
  - ADM_ASSET_EDIT — 아이콘·이미지 자산 교체 / page / 원본p131 / admin / UI: html/ADM_ASSET_EDIT.html
  - ADM_CATEGORY_IN_USE — 사용중 분류 비활성 영향 확인 / modal / 원본p132 / admin / UI: html/ADM_CATEGORY_IN_USE.html
  - ADM1 — 실적 대시보드 / page / 원본p30 / admin / UI: html/ADM1.html

## 검증/인계

- 프로그램 검증: 원본140행을14묶음에 정확히1회씩 배정. 누락0·중복0, iOS111/관리자29 확인. 화면 전체를 직접 시각검수한 결과가 아니라 인벤토리/계약/정책의 목록 검증이다.
- 현재 원본 정책/설계 미확정은 각 단계의 선행으로 유지한다. 완료된 최초스플래시→메인 표현은 재작성하지 않고 실제 데이터/3초 요청의 영향을 별도 후보로 검증한다.
- 개발과 대응QA는 기존 AUTH/IDENTITY/REGION/DISCOVERY/PORTFOLIO/SERVICE/QUOTE/CHAT/MEDIA/LEDGER/PRIVACY/NOTIFICATION/DEMO/ADMIN 카드에 연결한다. 신규 실행 전 카드별 정확 후보·파일 소유권·수용/거래시험·반환경로를 갱신하고 보드를 읽어 중복실행을 막는다.
- 최초 실제 API/DB/화면 개발 완료 또는 전체제품 완성을 이 목록으로 주장하지 않는다.
