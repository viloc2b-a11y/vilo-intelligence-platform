-- VIP formal memory module.
-- Apply manually after vip-hardening.sql.
-- Memory is not corpus and does not create procedural patterns.

create table if not exists vip.memory_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  scope text not null check (
    scope in ('platform', 'product', 'tenant', 'study', 'user', 'relationship', 'project')
  ),
  category text not null check (
    category in (
      'preference',
      'decision',
      'constraint',
      'assumption',
      'convention',
      'relationship_context',
      'operational_context',
      'compliance_context'
    )
  ),
  content text not null check (length(btrim(content)) > 0),
  metadata jsonb not null default '{}'::jsonb,
  confidence numeric not null default 1 check (confidence >= 0 and confidence <= 1),
  source_type text not null,
  source_ref_id text,
  status text not null default 'active' check (status in ('active', 'archived', 'superseded')),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (tenant_id is null or scope <> 'platform'),
  check (valid_until is null or valid_until > valid_from)
);

create table if not exists vip.memory_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  memory_entry_id uuid not null references vip.memory_entries(id) on delete restrict,
  actor_id uuid,
  event_type text not null check (event_type in ('remembered', 'recalled', 'updated', 'archived', 'superseded')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create trigger set_memory_entries_updated_at
before update on vip.memory_entries
for each row execute function vip.set_updated_at();

create or replace function vip.prevent_memory_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'vip.memory_events is append-only';
end;
$$;

create trigger memory_events_no_update
before update on vip.memory_events
for each row execute function vip.prevent_memory_event_mutation();

create trigger memory_events_no_delete
before delete on vip.memory_events
for each row execute function vip.prevent_memory_event_mutation();

create or replace function vip.audit_memory_entry_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into vip.memory_events (tenant_id, memory_entry_id, actor_id, event_type, metadata)
    values (new.tenant_id, new.id, new.created_by, 'remembered', jsonb_build_object('source_type', new.source_type));
    return new;
  end if;

  if old.status is distinct from new.status and new.status = 'archived' then
    insert into vip.memory_events (tenant_id, memory_entry_id, actor_id, event_type, metadata)
    values (new.tenant_id, new.id, new.created_by, 'archived', jsonb_build_object('previous_status', old.status));
  elsif old.status is distinct from new.status and new.status = 'superseded' then
    insert into vip.memory_events (tenant_id, memory_entry_id, actor_id, event_type, metadata)
    values (new.tenant_id, new.id, new.created_by, 'superseded', jsonb_build_object('previous_status', old.status));
  else
    insert into vip.memory_events (tenant_id, memory_entry_id, actor_id, event_type, metadata)
    values (new.tenant_id, new.id, new.created_by, 'updated', jsonb_build_object('previous_updated_at', old.updated_at));
  end if;

  return new;
end;
$$;

create trigger audit_memory_entry_insert
after insert on vip.memory_entries
for each row execute function vip.audit_memory_entry_change();

create trigger audit_memory_entry_update
after update on vip.memory_entries
for each row execute function vip.audit_memory_entry_change();

alter table vip.memory_entries enable row level security;
alter table vip.memory_events enable row level security;

create policy memory_entries_tenant_select on vip.memory_entries
  for select using (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy memory_entries_tenant_insert on vip.memory_entries
  for insert with check (tenant_id = vip.current_tenant_id());

create policy memory_entries_tenant_update on vip.memory_entries
  for update using (tenant_id = vip.current_tenant_id())
  with check (tenant_id = vip.current_tenant_id());

create policy memory_events_tenant_select on vip.memory_events
  for select using (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy memory_events_tenant_insert on vip.memory_events
  for insert with check (tenant_id = vip.current_tenant_id());

create index if not exists memory_entries_active_lookup_idx
  on vip.memory_entries (tenant_id, scope, category, status, valid_from, valid_until);

create index if not exists memory_entries_platform_lookup_idx
  on vip.memory_entries (scope, category, status)
  where tenant_id is null;

comment on table vip.memory_entries is
  'Formal VIP memory. Memory is not corpus, does not create procedural patterns, and cannot override protocol, safety, compliance, or approved runtime data.';

comment on table vip.memory_events is
  'Append-only audit stream for all VIP memory changes and recalls.';
