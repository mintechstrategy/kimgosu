-- KG-AUTH-CONSENT-INTEGRITY-01: prospective ordinary-DML integrity only.
-- No historical content verification/backfill, retention rule, DELETE/TRUNCATE
-- blocker, privilege expansion, SECURITY DEFINER, or new wire capability.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
-- Freeze both relations during cutoff classification, including direct writers.
LOCK TABLE kg_membership.policy_documents IN ACCESS EXCLUSIVE MODE;
LOCK TABLE kg_membership.consent_events IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE kg_membership.policy_documents
  ADD COLUMN content_sealed boolean NOT NULL DEFAULT false;
-- Technical metadata ONLY. Original document/event values are not repaired or
-- certified; legacy original content/provenance remains UNKNOWN.
UPDATE kg_membership.policy_documents d SET content_sealed = true
 WHERE d.status <> 'DRAFT' OR d.approved_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM kg_membership.consent_events e WHERE e.document_id=d.id);

CREATE FUNCTION kg_membership.policy_content_integrity_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
DECLARE protected boolean;
BEGIN
 IF TG_OP='UPDATE' THEN
  protected := OLD.content_sealed OR OLD.status<>'DRAFT' OR OLD.approved_at IS NOT NULL;
  IF protected AND
     (NEW.id,NEW.kind,NEW.version,NEW.title,NEW.body,NEW.body_sha256,
      NEW.operator_name,NEW.effective_at,NEW.approved_at,NEW.created_at)
       IS DISTINCT FROM
     (OLD.id,OLD.kind,OLD.version,OLD.title,OLD.body,OLD.body_sha256,
      OLD.operator_name,OLD.effective_at,OLD.approved_at,OLD.created_at) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SEALED_DOCUMENT_IMMUTABLE';
  END IF;
  IF NEW.content_sealed IS DISTINCT FROM OLD.content_sealed THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SEAL_METADATA_INTERNAL';
  END IF;
 ELSE
  protected := false;
  IF NEW.content_sealed IS DISTINCT FROM false THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SEAL_METADATA_INTERNAL';
  END IF;
 END IF;
 -- Preserve already-invalid legacy bytes on status-only/unchanged updates.
 -- Validate every new document, editable content change and first approval.
 IF TG_OP='INSERT' OR NOT protected THEN
  IF NEW.body_sha256<>encode(sha256(convert_to(NEW.body,'UTF8')),'hex') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='BODY_HASH_MISMATCH';
  END IF;
 END IF;
 NEW.content_sealed := protected OR NEW.status<>'DRAFT' OR NEW.approved_at IS NOT NULL;
 -- Status semantics/checks remain those of 001: no retirement-only workflow.
 RETURN NEW;
END $$;
CREATE TRIGGER policy_content_integrity_guard BEFORE INSERT OR UPDATE
 ON kg_membership.policy_documents FOR EACH ROW
 EXECUTE FUNCTION kg_membership.policy_content_integrity_guard();

CREATE FUNCTION kg_membership.consent_event_integrity_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d kg_membership.policy_documents%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CONSENT_EVENT_IMMUTABLE';
 END IF;
 -- Read/row-lock only: never UPDATE policy metadata in a grant transaction.
 -- Normal grants already hold table SHARE; an UPDATE here could deadlock two
 -- simultaneous readers upgrading to RowExclusive. The policy-write lifecycle
 -- seals before a document can acquire any NEW reference.
 SELECT * INTO d FROM kg_membership.policy_documents WHERE id=NEW.document_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='DOCUMENT_MISSING'; END IF;
 IF NOT d.content_sealed THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNSEALED_DOCUMENT_REFERENCE';
 END IF;
 IF NEW.action='GRANTED' THEN
  IF NOT (d.status='READY' AND d.approved_at IS NOT NULL AND d.effective_at<=now()
          AND d.operator_name IS NOT NULL AND length(trim(d.operator_name))>0) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DOCUMENT_NOT_READY';
  END IF;
  IF d.body_sha256<>encode(sha256(convert_to(d.body,'UTF8')),'hex') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='BODY_HASH_MISMATCH';
  END IF;
 END IF;
 -- WITHDRAWN preserves old referenced/retired/invalid-legacy withdrawal paths.
 RETURN NEW;
END $$;
CREATE TRIGGER consent_event_integrity_guard BEFORE INSERT OR UPDATE
 ON kg_membership.consent_events FOR EACH ROW
 EXECUTE FUNCTION kg_membership.consent_event_integrity_guard();
REVOKE ALL ON FUNCTION kg_membership.policy_content_integrity_guard(),
 kg_membership.consent_event_integrity_guard() FROM PUBLIC;
COMMIT;
