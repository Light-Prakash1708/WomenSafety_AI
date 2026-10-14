-- SAAHI initial schema
-- Every table is private to its owner through row level security.
-- Contacts without the app reach an alert only through the alert-public edge function,
-- which looks alerts up by an unguessable token.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  phone text,
  language text not null default 'en' check (language in ('en', 'hi', 'bn')),
  expo_push_token text,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Trusted contacts (the circle)
-- linked_user_id is filled when a contact signs up with the same phone number,
-- which lets them receive push alerts and see the alert inside the app.
-- ---------------------------------------------------------------------------
create table public.trusted_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  phone text not null check (char_length(phone) between 6 and 20),
  relation text,
  priority int not null default 1,
  linked_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.trusted_contacts (owner_id);
create index on public.trusted_contacts (phone);

create or replace function public.normalize_phone(p text)
returns text language sql immutable as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10)
$$;

-- Link contacts to accounts by the last 10 digits of the phone number.
create or replace function public.link_contacts_for_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phone is not null and (tg_op = 'INSERT' or new.phone is distinct from old.phone) then
    update public.trusted_contacts
       set linked_user_id = new.id
     where normalize_phone(phone) = normalize_phone(new.phone)
       and owner_id <> new.id;
  end if;
  return new;
end $$;

create trigger profiles_link_contacts
  after insert or update of phone on public.profiles
  for each row execute function public.link_contacts_for_profile();

create or replace function public.link_new_contact()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select p.id into new.linked_user_id
    from public.profiles p
   where normalize_phone(p.phone) = normalize_phone(new.phone)
     and p.id <> new.owner_id
   limit 1;
  return new;
end $$;

create trigger contacts_link_on_write
  before insert or update of phone on public.trusted_contacts
  for each row execute function public.link_new_contact();

-- ---------------------------------------------------------------------------
-- Alerts
-- A duress cancel keeps the alert active (duress = true) while the owner's
-- screen shows it as cancelled.
-- ---------------------------------------------------------------------------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'cancelled', 'resolved')),
  duress boolean not null default false,
  trigger text not null default 'hold' check (trigger in ('hold', 'shake', 'walk', 'manual', 'watchdog')),
  channel text not null default 'data' check (channel in ('data', 'sms')),
  public_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  last_lat double precision,
  last_lng double precision,
  last_accuracy double precision,
  last_seen_at timestamptz,
  battery double precision,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index on public.alerts (owner_id, started_at desc);

create table public.alert_locations (
  id bigint generated always as identity primary key,
  alert_id uuid not null references public.alerts (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  recorded_at timestamptz not null default now()
);
create index on public.alert_locations (alert_id, recorded_at desc);

-- Keep alerts.last_* in step with the newest location row.
create or replace function public.bump_alert_location()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.alerts
     set last_lat = new.lat, last_lng = new.lng,
         last_accuracy = new.accuracy, last_seen_at = new.recorded_at
   where id = new.alert_id;
  return new;
end $$;

create trigger alert_locations_bump
  after insert on public.alert_locations
  for each row execute function public.bump_alert_location();

-- Who was asked for help, and what happened.
create table public.alert_recipients (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.alerts (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  contact_id uuid references public.trusted_contacts (id) on delete set null,
  name text not null,
  channel text not null default 'sms' check (channel in ('sms', 'push')),
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'opened', 'acknowledged', 'failed')),
  message text,
  updated_at timestamptz not null default now()
);
create index on public.alert_recipients (alert_id);

-- ---------------------------------------------------------------------------
-- Walk with me
-- ---------------------------------------------------------------------------
create table public.journeys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  destination text not null,
  interval_minutes int not null default 5 check (interval_minutes between 1 and 60),
  status text not null default 'active' check (status in ('active', 'arrived', 'missed', 'cancelled')),
  next_checkin_at timestamptz not null,
  alert_id uuid references public.alerts (id) on delete set null,
  last_lat double precision,
  last_lng double precision,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index on public.journeys (status, next_checkin_at);

-- ---------------------------------------------------------------------------
-- Pattern (Escalation Graph)
-- ---------------------------------------------------------------------------
create table public.pattern_threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);

create table public.pattern_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid not null references public.pattern_threads (id) on delete cascade,
  kind text not null check (kind in ('message', 'new_account', 'call', 'in_person', 'blocked', 'threat', 'other')),
  occurred_at timestamptz not null default now(),
  channel text,
  handle text,
  note text,
  vault_item_id uuid,
  created_at timestamptz not null default now()
);
create index on public.pattern_entries (thread_id, occurred_at);

create table public.pattern_summaries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid not null references public.pattern_threads (id) on delete cascade,
  body text not null,
  source text not null default 'ai' check (source in ('ai', 'rules')),
  edited boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Evidence vault (files live in the private "vault" storage bucket)
-- ---------------------------------------------------------------------------
create table public.vault_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('photo', 'audio', 'screenshot', 'document', 'note')),
  label text not null default '',
  storage_path text,
  sha256 text not null,
  size_bytes bigint,
  mime text,
  source text not null default 'upload' check (source in ('upload', 'sos_recording', 'pattern')),
  alert_id uuid references public.alerts (id) on delete set null,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on public.vault_items (owner_id, captured_at desc);

alter table public.pattern_entries
  add constraint pattern_entries_vault_fk foreign key (vault_item_id)
  references public.vault_items (id) on delete set null;

-- Every vault read or export is logged so she can see who saw what.
create table public.vault_access_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  vault_item_id uuid references public.vault_items (id) on delete cascade,
  action text not null check (action in ('view', 'export', 'delete')),
  at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Community safety layer: area-level reports, never names or routines.
-- geohash6 is roughly a 1.2 km x 0.6 km cell.
-- ---------------------------------------------------------------------------
create table public.community_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  geohash6 text not null check (char_length(geohash6) = 6),
  area_label text,
  category text not null check (category in ('poor_lighting', 'harassment', 'unsafe_transport', 'no_security', 'isolated')),
  time_band text not null check (time_band in ('morning', 'afternoon', 'evening', 'night')),
  created_at timestamptz not null default now()
);
create index on public.community_reports (geohash6);

-- Aggregated, threshold-gated view of an area. Only categories with at least
-- 3 distinct reporters in the last 180 days are returned.
create or replace function public.area_safety(cells text[])
returns table (geohash6 text, area_label text, category text, time_band text, reporters bigint)
language sql security definer set search_path = public stable as $$
  select r.geohash6,
         max(r.area_label) as area_label,
         r.category,
         mode() within group (order by r.time_band) as time_band,
         count(distinct r.reporter_id) as reporters
    from public.community_reports r
   where r.geohash6 = any(cells)
     and r.created_at > now() - interval '180 days'
   group by r.geohash6, r.category
  having count(distinct r.reporter_id) >= 3
   order by reporters desc
$$;
revoke all on function public.area_safety(text[]) from public, anon;
grant execute on function public.area_safety(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.trusted_contacts enable row level security;
alter table public.alerts enable row level security;
alter table public.alert_locations enable row level security;
alter table public.alert_recipients enable row level security;
alter table public.journeys enable row level security;
alter table public.pattern_threads enable row level security;
alter table public.pattern_entries enable row level security;
alter table public.pattern_summaries enable row level security;
alter table public.vault_items enable row level security;
alter table public.vault_access_log enable row level security;
alter table public.community_reports enable row level security;

create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "own contacts" on public.trusted_contacts
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "own alerts" on public.alerts
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- A guardian who has the app can see an active alert from someone who lists them.
create or replace function public.is_guardian_of(owner uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.trusted_contacts tc
     where tc.owner_id = owner and tc.linked_user_id = auth.uid()
  )
$$;

create policy "guardian sees active alerts" on public.alerts
  for select using (status = 'active' and public.is_guardian_of(owner_id));

create policy "own alert locations" on public.alert_locations
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "guardian sees alert locations" on public.alert_locations
  for select using (
    exists (select 1 from public.alerts a
             where a.id = alert_id and a.status = 'active' and public.is_guardian_of(a.owner_id))
  );

create policy "own alert recipients" on public.alert_recipients
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "guardian sees recipients" on public.alert_recipients
  for select using (
    exists (select 1 from public.alerts a
             where a.id = alert_id and a.status = 'active' and public.is_guardian_of(a.owner_id))
  );

-- Guardians acknowledge through a function so they can only touch their own row.
create or replace function public.guardian_acknowledge(p_alert uuid, p_message text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select owner_id into v_owner from public.alerts where id = p_alert and status = 'active';
  if v_owner is null or not public.is_guardian_of(v_owner) then
    raise exception 'not allowed';
  end if;
  update public.alert_recipients r
     set status = 'acknowledged', message = left(p_message, 280), updated_at = now()
   where r.alert_id = p_alert
     and r.contact_id in (select id from public.trusted_contacts
                           where owner_id = v_owner and linked_user_id = auth.uid());
end $$;
revoke all on function public.guardian_acknowledge(uuid, text) from public, anon;
grant execute on function public.guardian_acknowledge(uuid, text) to authenticated;

create policy "own journeys" on public.journeys
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own threads" on public.pattern_threads
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own entries" on public.pattern_entries
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own summaries" on public.pattern_summaries
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own vault" on public.vault_items
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own vault log read" on public.vault_access_log
  for select using (owner_id = auth.uid());
create policy "own vault log write" on public.vault_access_log
  for insert with check (owner_id = auth.uid());
create policy "own community reports" on public.community_reports
  for all using (reporter_id = auth.uid()) with check (reporter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage: private vault bucket, one folder per user (<uid>/...)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('vault', 'vault', false, 52428800)
on conflict (id) do nothing;

create policy "vault read own" on storage.objects
  for select using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "vault write own" on storage.objects
  for insert with check (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "vault delete own" on storage.objects
  for delete using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Realtime: the SOS screen listens for acknowledgements.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.alert_recipients;
alter publication supabase_realtime add table public.alerts;
