-- Run once in the Supabase SQL editor AFTER deploying the journey-watchdog function.
-- Replace <PROJECT_REF> and <CRON_SECRET> (the same value you set with
-- `supabase secrets set CRON_SECRET=...`).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'saahi-journey-watchdog',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/journey-watchdog',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb
  );
  $$
);
