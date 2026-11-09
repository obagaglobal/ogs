-- Job photos: the uploader may see a job.evidence file only inside the uploading
-- transaction (policy file_metadata_select_job_evidence: created_at = now()), so
-- that app.protect_job_work() can read it before the job_evidence row exists.
--
-- Prisma fills @default(now()) on the client and sends created_at explicitly, so
-- the stored value never equals the transaction's now() and every photo upload was
-- refused. The database now stamps job.evidence rows itself.
CREATE OR REPLACE FUNCTION app.stamp_job_evidence_file() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW."purpose" = 'job.evidence' THEN
    NEW."created_at" := now();
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.stamp_job_evidence_file() FROM PUBLIC;
CREATE TRIGGER "file_metadata_stamp_job_evidence" BEFORE INSERT ON "file_metadata"
  FOR EACH ROW EXECUTE FUNCTION app.stamp_job_evidence_file();
