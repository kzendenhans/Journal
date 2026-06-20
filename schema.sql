-- Run this in Supabase → SQL Editor

create table if not exists habit_entries (
  id uuid default uuid_generate_v4() primary key,
  date date not null unique,
  -- Essentials
  gym boolean default false,
  gewerkt boolean default false,
  geklust boolean default false,
  geschreven boolean default false,
  -- Bonuses
  geleest boolean default false,
  gemediteerd boolean default false,
  tijd_met_anderen boolean default false,
  gespeeld boolean default false,
  -- Aandachtspunten
  te_veel_weinig_eten boolean default false,
  gedoomscrolled boolean default false,
  gemasturbeerd boolean default false,
  porno_gekeken boolean default false,
  -- Tracking
  slaap numeric(3,1),
  gewicht numeric(4,1),
  mood_emoji text,
  blij boolean default false,
  bang boolean default false,
  boos boolean default false,
  verdrietig boolean default false,
  notities text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Allow public read/write (for personal use without auth)
alter table habit_entries enable row level security;
create policy "Public access" on habit_entries for all using (true) with check (true);
