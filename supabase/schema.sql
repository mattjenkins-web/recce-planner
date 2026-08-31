-- RecceBuddy database schema (Supabase / Postgres)
-- Run this once in the Supabase SQL Editor after the project is created.
--
-- Design notes:
--  * Photo BYTES stay in Netlify Blobs (already working, not the bottleneck).
--    `photos.blob_key` just points at the existing blob key so nothing about
--    upload/serving has to change — only the metadata moves to real rows.
--  * Ownership is per-job (`jobs.owner_id`), enforced by row-level security
--    below, so "100s of users" naturally only ever see their own jobs.
--  * `photos.rating`/`hidden`/`sort_order` replace the old shared JSON
--    "board" files — one row per photo instead of one growing blob per job.

create extension if not exists pgcrypto; -- for gen_random_uuid()

-- Auto-created alongside every auth.users signup (see trigger below) so the
-- app has a place for display-name/avatar without touching Supabase's own
-- auth table directly.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  shoot_date date,
  client text[] not null default '{}',
  agency text[] not null default '{}',
  production_company text[] not null default '{}',
  director text[] not null default '{}',
  producer text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index jobs_owner_idx on public.jobs(owner_id);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index locations_job_idx on public.locations(job_id);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  blob_key text not null,          -- Netlify Blobs key holding the actual image bytes
  filename text,
  content_type text,
  shot_type text,                  -- null = Cadrage/camera frame, 'iphone' = Scout, 'sunseeker' = Sun
  lat double precision,
  lon double precision,
  has_gps boolean not null default false,
  bearing integer,
  tilt integer,
  lens text,
  camera_make text,
  camera_model text,
  captured_at timestamptz,
  notes text,
  rating integer not null default 0,
  hidden boolean not null default false,
  sort_order integer not null default 0,  -- drag-arranged "Custom order", now shared for the whole team instead of per-browser
  uploaded_at timestamptz not null default now()
);
create index photos_location_idx on public.photos(location_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references public.photos(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null,   -- snapshot of the display name at post time, so a later name change doesn't rewrite history
  text text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index comments_photo_idx on public.comments(photo_id);

-- Keep a profile row in sync with every signup automatically.
create function public.handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Row-level security: every table is owner-scoped via the job it belongs to.
-- (Team-sharing a job with other accounts is a natural next step — a
-- job_members table plus an additional policy branch — once this baseline
-- is in place.)
alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.locations enable row level security;
alter table public.photos enable row level security;
alter table public.comments enable row level security;

create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id);

create policy "jobs: owner full access" on public.jobs
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "locations: via owned job" on public.locations
  for all using (exists (select 1 from public.jobs j where j.id = job_id and j.owner_id = auth.uid()))
  with check (exists (select 1 from public.jobs j where j.id = job_id and j.owner_id = auth.uid()));

create policy "photos: via owned job" on public.photos
  for all using (exists (
    select 1 from public.locations l join public.jobs j on j.id = l.job_id
    where l.id = location_id and j.owner_id = auth.uid()
  )) with check (exists (
    select 1 from public.locations l join public.jobs j on j.id = l.job_id
    where l.id = location_id and j.owner_id = auth.uid()
  ));

create policy "comments: via owned job" on public.comments
  for all using (exists (
    select 1 from public.photos p
    join public.locations l on l.id = p.location_id
    join public.jobs j on j.id = l.job_id
    where p.id = photo_id and j.owner_id = auth.uid()
  )) with check (exists (
    select 1 from public.photos p
    join public.locations l on l.id = p.location_id
    join public.jobs j on j.id = l.job_id
    where p.id = photo_id and j.owner_id = auth.uid()
  ));
