-- Draft only. Do not apply automatically.
-- VIP does not assume Supabase exists yet.

create table if not exists vip_contexts (
  id text primary key,
  subject text not null,
  product_surface text,
  metadata jsonb,
  created_at timestamptz not null
);

create table if not exists vip_artifacts (
  id text primary key,
  context_id text not null,
  artifact_type text not null,
  title text not null,
  body text not null,
  status text not null,
  metadata jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists vip_audit_events (
  id text primary key,
  action text not null,
  artifact_id text,
  context_id text,
  metadata jsonb,
  created_at timestamptz not null
);
