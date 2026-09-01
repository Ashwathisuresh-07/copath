-- Copath database schema
-- Run this in your Supabase project's SQL Editor (Database > SQL Editor > New query)

create extension if not exists "pgcrypto";

-- ============ 0. CLEAN SLATE ============
-- Safe to run even on a fresh project. Also lets you re-run this whole script
-- if an earlier attempt failed partway through.
drop table if exists public.requests cascade;
drop table if exists public.trips cascade;
drop table if exists public.profiles cascade;

-- ============ 1. CREATE ALL TABLES FIRST ============
-- (policies below reference across tables, so every table must exist first)

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text not null,
  created_at timestamptz not null default now()
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  poster_id uuid not null references auth.users(id) on delete cascade,
  poster_name text not null,
  destination text not null,
  date date not null,
  time time not null,
  seats int not null default 1,
  notes text,
  created_at timestamptz not null default now()
);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  poster_id uuid not null references auth.users(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  requester_name text not null,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  unique (trip_id, requester_id)
);

-- ============ 2. ENABLE ROW LEVEL SECURITY ============

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.requests enable row level security;

-- ============ 3. POLICIES: profiles ============

-- You can always see your own profile
create policy "view own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- You can see someone else's profile (i.e. their phone number) ONLY if
-- you have an accepted request connecting the two of you
create policy "view profile after accepted request"
  on public.profiles for select
  using (
    exists (
      select 1 from public.requests r
      where r.status = 'accepted'
        and (
          (r.requester_id = auth.uid() and r.poster_id = profiles.id) or
          (r.poster_id = auth.uid() and r.requester_id = profiles.id)
        )
    )
  );

create policy "insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- ============ 4. POLICIES: trips ============

create policy "any signed-in user can view trips"
  on public.trips for select
  using (auth.role() = 'authenticated');

create policy "users insert their own trips"
  on public.trips for insert
  with check (auth.uid() = poster_id);

create policy "users delete their own trips"
  on public.trips for delete
  using (auth.uid() = poster_id);

-- ============ 5. POLICIES: requests ============

-- Only the two people involved in a request can see it
create policy "participants view their requests"
  on public.requests for select
  using (auth.uid() = poster_id or auth.uid() = requester_id);

-- You can only create a request as yourself, and not for your own trip
create policy "users create requests as themselves"
  on public.requests for insert
  with check (auth.uid() = requester_id and auth.uid() <> poster_id);

-- Only the trip's poster can accept/reject a request on it
create policy "posters update status of their trip's requests"
  on public.requests for update
  using (auth.uid() = poster_id)
  with check (auth.uid() = poster_id);

-- ============ 6. REALTIME ============
-- Lets the app auto-refresh the feed and requests without polling

alter publication supabase_realtime add table public.trips;
alter publication supabase_realtime add table public.requests;
