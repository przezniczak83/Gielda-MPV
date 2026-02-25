-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0013_storage_bucket.sql
-- Tworzy bucket "reports" w Supabase Storage dla raportów PDF.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', false)
ON CONFLICT (id) DO NOTHING;

-- Service role can upload/download
CREATE POLICY "service_role_reports"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'reports');
