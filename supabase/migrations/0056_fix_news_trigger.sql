-- 0056_fix_news_trigger.sql
-- Fix news_items_process_trigger.
--
-- Root cause of original failure (0053):
--   1. vault.secrets read failed in trigger security context
--      → "column value does not exist" error blocking every INSERT
--   2. RETURN NEW used in FOR EACH STATEMENT trigger
--      → NEW/OLD don't exist for statement-level triggers; return NULL instead
--   3. extensions.http_post — wrong schema; correct function is net.http_post
--
-- Fix:
--   1. Hardcode anon key (public key, safe to embed)
--   2. RETURN NULL for statement-level trigger
--   3. net.http_post (pg_net, already installed)
--   4. EXCEPTION WHEN OTHERS THEN NULL — never blocks INSERT

-- Drop old broken version first
DROP TRIGGER IF EXISTS news_items_process_trigger ON public.news_items;
DROP FUNCTION IF EXISTS public.trigger_process_news();

-- Corrected trigger function
CREATE OR REPLACE FUNCTION public.trigger_process_news()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/process-news',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmdGdtb3JzdGhvZXpobW9qanBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MTg5NjgsImV4cCI6MjA4NzI5NDk2OH0.n-C2nU22m0-cMa9WxE-n-arRAD8oZo0XF9946aWLvRk'
      ),
      body    := '{"trigger": true}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    -- Best-effort: never block INSERT regardless of HTTP/network errors
    NULL;
  END;
  RETURN NULL;  -- statement-level triggers must return NULL (not NEW/OLD)
END;
$$;

-- Re-create trigger: AFTER INSERT, FOR EACH STATEMENT
-- Fires once per batch INSERT (fetch-news inserts 50-200 rows at a time)
CREATE TRIGGER news_items_process_trigger
  AFTER INSERT ON public.news_items
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trigger_process_news();
