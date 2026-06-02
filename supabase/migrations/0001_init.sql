-- ZapIntel initial schema.
--
-- Run this once in the Supabase SQL editor against your project.
-- It is idempotent (safe to re-run): every CREATE uses IF NOT EXISTS
-- and policies are dropped before being re-created.
--
-- Tables:
--   reports         — saved client-intelligence reports, one row per save.
--                     Row-level security ensures each authenticated user
--                     can only see / modify their own rows.
--
-- The team-email allowlist is enforced in application code (Next.js
-- middleware reads WHITELIST_EMAILS env). Keeping it out of Postgres
-- means you can rotate the list by editing one env var, no SQL.

-- ──────────────────────────────────────────────────────────────────────
-- reports table
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.reports (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,

  -- prospect input
  company_name    text not null,
  website_url     text not null,
  industry        text,
  known_context   text,
  zapsight_offer  text,

  -- output
  summary         text,
  dimensions      jsonb not null default '[]'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists reports_user_id_created_at_idx
  on public.reports (user_id, created_at desc);

create index if not exists reports_company_name_idx
  on public.reports (lower(company_name));

-- updated_at auto-touch
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists reports_touch_updated_at on public.reports;
create trigger reports_touch_updated_at
  before update on public.reports
  for each row execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- Row-level security
-- ──────────────────────────────────────────────────────────────────────
alter table public.reports enable row level security;

drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own" on public.reports
  for select using (auth.uid() = user_id);

drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports
  for insert with check (auth.uid() = user_id);

drop policy if exists "reports_update_own" on public.reports;
create policy "reports_update_own" on public.reports
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "reports_delete_own" on public.reports;
create policy "reports_delete_own" on public.reports
  for delete using (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────
-- Done.
-- ──────────────────────────────────────────────────────────────────────
-- Verify with:
--   select * from pg_policies where tablename = 'reports';
