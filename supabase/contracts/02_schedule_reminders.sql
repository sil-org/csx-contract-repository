-- Schedules the daily contract-reminder run (pg_cron + pg_net), the same
-- mechanism license-manager uses for its weekly digests — see its
-- supabase/pending/35_schedule_reminder_crons.sql.
--
-- Auth: the Authorization header references the existing Vault secret
-- 'cron_secret' (shared with license-manager, same project) — no literal
-- secret in this committed file. The matching CRON_SECRET Edge Function secret
-- is already set for license-manager's functions; the project-wide secret is
-- visible to this repo's functions too.
--
-- Timing: 13:00 UTC daily (~8 AM US Central in daylight time, 7 AM in
-- standard time — pg_cron has no DST awareness; harmless for a daily job).
-- Idempotent: unschedules first, so re-running is safe.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

do $$ begin perform cron.unschedule('contract-daily-reminders'); exception when others then null; end $$;

select cron.schedule(
  'contract-daily-reminders',
  '0 13 * * *',
  $$
  select net.http_post(
    url := 'https://lxomebvymgolbzgkxqgu.supabase.co/functions/v1/contract-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
