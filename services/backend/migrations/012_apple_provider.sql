-- WS-21: Apple 로그인 활성화 — oauth_flows/social_links 의 provider CHECK 에 apple 추가.
--
-- 001_membership.sql(social_links)과 002_auth_lifecycle.sql(oauth_flows)이 만든
-- CHECK 제약은 ('google','kakao','naver') 만 허용해 apple flow 저장이 23514로
-- 거부됐다(isProviderCheckViolation → 503 PROVIDER_SCHEMA_PENDING).
-- 기존 행을 깨지 않도록 CHECK 를 DROP 후 재생성한다. 제약 이름은 Postgres 기본
-- 이름(<table>_<column>_check)이며 코드의 isProviderCheckViolation 과 동일하다.
--
-- 되돌리기(rollback): apple 행이 없는 상태에서 아래 두 CHECK 를 원래 목록으로
-- 다시 DROP/ADD 하면 된다. apple 행이 있으면 되돌리기 전에 삭제·이관이 필요하다.
-- 적용 대상: 격리된 개발/테스트 DB. 운영 DB 적용은 별도 승인 사항이다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

ALTER TABLE kg_membership.social_links DROP CONSTRAINT IF EXISTS social_links_provider_check;
ALTER TABLE kg_membership.social_links ADD CONSTRAINT social_links_provider_check
  CHECK (provider IN ('kakao','naver','google','apple'));

ALTER TABLE kg_membership.oauth_flows DROP CONSTRAINT IF EXISTS oauth_flows_provider_check;
ALTER TABLE kg_membership.oauth_flows ADD CONSTRAINT oauth_flows_provider_check
  CHECK (provider IN ('google','kakao','naver','apple'));

COMMIT;
