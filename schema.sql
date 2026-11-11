-- Run this in Supabase → SQL Editor

create table if not exists habit_entries (
  id uuid default uuid_generate_v4() primary key,
  date date not null unique,
  -- Essentials
  gym boolean default false,
  gewerkt boolean default false,
  geklust boolean default false,
  geschreven boolean default false,
  stretch_routine boolean default false,
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

create table if not exists sensor_logs (
  id uuid default uuid_generate_v4() primary key,
  started_at timestamptz not null default now(),
  note text,
  created_at timestamptz default now()
);

alter table sensor_logs enable row level security;
create policy "Public access" on sensor_logs for all using (true) with check (true);

create table if not exists tarot_draws (
  id uuid default uuid_generate_v4() primary key,
  card text not null,
  drawn_on date not null default current_date,
  note text,
  created_at timestamptz default now()
);

alter table tarot_draws enable row level security;
create policy "Public access" on tarot_draws for all using (true) with check (true);

-- ── Voeding (v1.65) ─────────────────────────────────────────────────────────
create table if not exists food_days (
  date date primary key,
  entries jsonb not null default '{}',
  extras jsonb not null default '[]',
  plan jsonb not null default '{}',
  flags jsonb not null default '{}',
  updated_at timestamptz default now()
);

alter table food_days enable row level security;
create policy "Public access" on food_days for all using (true) with check (true);

create table if not exists food_settings (
  id int primary key default 1,
  data jsonb not null default '{}',
  updated_at timestamptz default now()
);

alter table food_settings enable row level security;
create policy "Public access" on food_settings for all using (true) with check (true);
