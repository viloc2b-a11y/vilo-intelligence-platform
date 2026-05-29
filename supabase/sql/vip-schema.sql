-- VIP production SQL foundation: base schema.
-- Apply manually first. Do not apply automatically.

create extension if not exists pgcrypto;
create extension if not exists vector;

create schema if not exists vip;

create or replace function vip.current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

create or replace function vip.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists vip.corpus_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  pack_id text not null,
  source_type text not null,
  source_id text,
  title text not null,
  body text not null,
  tags text[] not null default '{}',
  evidence jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vip.artifacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  context_id text,
  idempotency_key text,
  artifact_type text not null,
  title text not null,
  body text not null,
  evidence jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (
    status in ('draft', 'pending_approval', 'approved', 'rejected', 'published', 'fallback_pending')
  ),
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, idempotency_key)
);

create table if not exists vip.feedback (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  artifact_id uuid references vip.artifacts(id) on delete set null,
  corpus_entry_id uuid references vip.corpus_entries(id) on delete set null,
  reviewer_id uuid,
  body text not null,
  category text,
  creates_learning_candidate boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists vip.approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  artifact_id uuid references vip.artifacts(id) on delete cascade,
  reviewer_id uuid not null,
  status text not null check (status in ('requested', 'approved', 'rejected')),
  reviewer_override_reason text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists vip.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  actor_id uuid,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create trigger set_corpus_entries_updated_at
before update on vip.corpus_entries
for each row execute function vip.set_updated_at();

create trigger set_artifacts_updated_at
before update on vip.artifacts
for each row execute function vip.set_updated_at();

alter table vip.corpus_entries enable row level security;
alter table vip.artifacts enable row level security;
alter table vip.feedback enable row level security;
alter table vip.approvals enable row level security;
alter table vip.audit_log enable row level security;

create policy corpus_entries_tenant_select on vip.corpus_entries
  for select using (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy corpus_entries_tenant_insert on vip.corpus_entries
  for insert with check (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy corpus_entries_tenant_update on vip.corpus_entries
  for update using (tenant_id is null or tenant_id = vip.current_tenant_id())
  with check (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy artifacts_tenant_select on vip.artifacts
  for select using (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy artifacts_tenant_insert on vip.artifacts
  for insert with check (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy artifacts_tenant_update on vip.artifacts
  for update using (tenant_id is null or tenant_id = vip.current_tenant_id())
  with check (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy feedback_tenant_select on vip.feedback
  for select using (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy feedback_tenant_insert on vip.feedback
  for insert with check (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy approvals_tenant_select on vip.approvals
  for select using (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy approvals_tenant_insert on vip.approvals
  for insert with check (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy approvals_tenant_update on vip.approvals
  for update using (tenant_id is null or tenant_id = vip.current_tenant_id())
  with check (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy audit_log_tenant_select on vip.audit_log
  for select using (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy audit_log_tenant_insert on vip.audit_log
  for insert with check (tenant_id is null or tenant_id = vip.current_tenant_id());

create or replace function vip.prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'vip.audit_log is append-only';
end;
$$;

create trigger audit_log_no_update
before update on vip.audit_log
for each row execute function vip.prevent_audit_log_mutation();

create trigger audit_log_no_delete
before delete on vip.audit_log
for each row execute function vip.prevent_audit_log_mutation();
