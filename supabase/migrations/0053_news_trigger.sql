-- 0053_news_trigger.sql
-- pg_net trigger: invoke process-news immediately after every batch INSERT
-- into news_items. Fires FOR EACH STATEMENT (once per batch, not per row).
--
-- pg_net is async — the trigger does not block the INSERT.
-- Authorization uses vault.secrets (same pattern as cron jobs).

-- pg_net is pre-installed on Supabase — just ensure the extension is enabled
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── Trigger function ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trigger_process_news()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  anon_key text;
BEGIN
  -- Read anon key from vault (same pattern as cron jobs in 0049)
  SELECT value INTO anon_key
  FROM vault.secrets
  WHERE name = 'supabase_anon_key'
  LIMIT 1;

  -- Fire-and-forget async HTTP call to process-news
  PERFORM extensions.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/process-news',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || COALESCE(anon_key, '')
    ),
    body    := '{"trigger": true}'::jsonb
  );

  RETURN NULL;
END;
$$;

-- ── Trigger: AFTER INSERT, FOR EACH STATEMENT ────────────────────────────────
-- FOR EACH STATEMENT fires once per INSERT batch (not per row).
-- fetch-news inserts 50-200 articles at once → 1 trigger invocation.

DROP TRIGGER IF EXISTS news_items_process_trigger ON public.news_items;

CREATE TRIGGER news_items_process_trigger
  AFTER INSERT ON public.news_items
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trigger_process_news();
