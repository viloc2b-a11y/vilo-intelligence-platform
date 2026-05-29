-- VIP production SQL foundation: validated memory and learning loop.
-- Apply manually after vip-schema.sql.

create table if not exists vip.corpus_entry_versions (
  id uuid primary key default gen_random_uuid(),
  corpus_entry_id uuid not null references vip.corpus_entries(id) on delete cascade,
  tenant_id uuid,
  version_number bigint not null,
  snapshot jsonb not null,
  snapshot_reason text not null,
  reviewer_id uuid not null,
  created_at timestamptz not null default now(),
  unique (corpus_entry_id, version_number)
);

create table if not exists vip.learning_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  corpus_entry_id uuid references vip.corpus_entries(id) on delete set null,
  feedback_id uuid references vip.feedback(id) on delete set null,
  candidate_type text not null check (candidate_type in ('create', 'update', 'archive')),
  proposed_title text,
  proposed_body text,
  proposed_tags text[],
  proposed_evidence jsonb not null default '[]'::jsonb,
  proposed_metadata jsonb not null default '{}'::jsonb,
  rationale text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'applied')),
  reviewer_id uuid,
  reviewer_notes text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  applied_at timestamptz,
  unique nulls not distinct (tenant_id, idempotency_key)
);

create table if not exists vip.usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  corpus_entry_id uuid references vip.corpus_entries(id) on delete set null,
  artifact_id uuid references vip.artifacts(id) on delete set null,
  event_type text not null,
  resolver_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists vip.pattern_scores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  pattern_key text not null,
  pack_id text,
  score numeric(10, 4) not null default 0,
  usage_count bigint not null default 0,
  positive_feedback_count bigint not null default 0,
  negative_feedback_count bigint not null default 0,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, pattern_key, pack_id)
);

create table if not exists vip.job_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  job_name text not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  error_message text
);

create trigger set_pattern_scores_updated_at
before update on vip.pattern_scores
for each row execute function vip.set_updated_at();

alter table vip.corpus_entry_versions enable row level security;
alter table vip.learning_candidates enable row level security;
alter table vip.usage_events enable row level security;
alter table vip.pattern_scores enable row level security;
alter table vip.job_runs enable row level security;

create policy corpus_entry_versions_tenant_select on vip.corpus_entry_versions
  for select using (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy corpus_entry_versions_tenant_insert on vip.corpus_entry_versions
  for insert with check (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy learning_candidates_tenant_select on vip.learning_candidates
  for select using (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy learning_candidates_tenant_insert on vip.learning_candidates
  for insert with check (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy learning_candidates_tenant_update on vip.learning_candidates
  for update using (tenant_id is null or tenant_id = vip.current_tenant_id())
  with check (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy usage_events_tenant_select on vip.usage_events
  for select using (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy usage_events_tenant_insert on vip.usage_events
  for insert with check (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy pattern_scores_tenant_select on vip.pattern_scores
  for select using (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy pattern_scores_tenant_insert on vip.pattern_scores
  for insert with check (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy pattern_scores_tenant_update on vip.pattern_scores
  for update using (tenant_id is null or tenant_id = vip.current_tenant_id())
  with check (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy job_runs_tenant_select on vip.job_runs
  for select using (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy job_runs_tenant_insert on vip.job_runs
  for insert with check (tenant_id is null or tenant_id = vip.current_tenant_id());

create policy job_runs_tenant_update on vip.job_runs
  for update using (tenant_id is null or tenant_id = vip.current_tenant_id())
  with check (tenant_id is null or tenant_id = vip.current_tenant_id());

create or replace function vip.snapshot_corpus_entry_before_learning_update()
returns trigger
language plpgsql
as $$
declare
  next_version bigint;
begin
  if old is distinct from new then
    if nullif(new.metadata ->> 'snapshot_reason', '') is distinct from 'approved_learning_candidate' then
      return new;
    end if;

    if new.updated_by is null then
      raise exception 'human reviewer_id is required before applying learning updates';
    end if;

    select coalesce(max(version_number), 0) + 1
      into next_version
      from vip.corpus_entry_versions
      where corpus_entry_id = old.id;

    insert into vip.corpus_entry_versions (
      corpus_entry_id,
      tenant_id,
      version_number,
      snapshot,
      snapshot_reason,
      reviewer_id
    )
    values (
      old.id,
      old.tenant_id,
      next_version,
      to_jsonb(old),
      new.metadata ->> 'snapshot_reason',
      new.updated_by
    );
  end if;

  return new;
end;
$$;

create trigger snapshot_corpus_entry_before_learning_update
before update on vip.corpus_entries
for each row
when (old is distinct from new)
execute function vip.snapshot_corpus_entry_before_learning_update();

create or replace function vip.run_learning_job(p_tenant_id uuid default vip.current_tenant_id())
returns uuid
language plpgsql
as $$
declare
  job_id uuid;
  candidate_count integer;
begin
  insert into vip.job_runs (tenant_id, job_name, status)
  values (p_tenant_id, 'learning', 'running')
  returning id into job_id;

  insert into vip.learning_candidates (
    tenant_id,
    corpus_entry_id,
    feedback_id,
    candidate_type,
    proposed_title,
    proposed_body,
    proposed_tags,
    proposed_evidence,
    proposed_metadata,
    rationale,
    idempotency_key
  )
  select
    f.tenant_id,
    f.corpus_entry_id,
    f.id,
    case when f.corpus_entry_id is null then 'create' else 'update' end,
    coalesce(c.title, 'Learning candidate'),
    f.body,
    coalesce(c.tags, '{}'),
    coalesce(c.evidence, '[]'::jsonb),
    jsonb_build_object('source_feedback_id', f.id),
    'Generated from human-approved feedback.',
    encode(digest(coalesce(f.tenant_id::text, 'platform') || ':' || f.id::text, 'sha256'), 'hex')
  from vip.feedback f
  left join vip.corpus_entries c on c.id = f.corpus_entry_id
  where f.creates_learning_candidate = true
    and f.reviewer_id is not null
    and (p_tenant_id is null or f.tenant_id is null or f.tenant_id = p_tenant_id)
    and not exists (
      select 1 from vip.learning_candidates lc
      where lc.feedback_id = f.id
        and lc.status in ('pending', 'approved', 'applied')
    );

  get diagnostics candidate_count = row_count;

  insert into vip.audit_log (tenant_id, event_type, entity_type, entity_id, metadata)
  values (
    p_tenant_id,
    'learning_job_run',
    'job_run',
    job_id,
    jsonb_build_object('candidate_count', candidate_count)
  );

  update vip.job_runs
     set status = 'succeeded',
         finished_at = now(),
         metadata = jsonb_build_object('candidate_count', candidate_count)
   where id = job_id;

  return job_id;
exception
  when others then
    if job_id is not null then
      update vip.job_runs
         set status = 'failed',
             finished_at = now(),
             error_message = sqlerrm
       where id = job_id;
    end if;
    raise;
end;
$$;

create or replace function vip.apply_learning_candidate(
  p_candidate_id uuid,
  p_reviewer_id uuid,
  p_approve boolean,
  p_reviewer_notes text default null
)
returns uuid
language plpgsql
as $$
declare
  candidate vip.learning_candidates%rowtype;
  target_entry_id uuid;
begin
  if p_reviewer_id is null then
    raise exception 'human reviewer_id is required';
  end if;

  select * into candidate
    from vip.learning_candidates
    where id = p_candidate_id
    for update;

  if not found then
    raise exception 'learning candidate % not found', p_candidate_id;
  end if;

  if candidate.status <> 'pending' then
    raise exception 'learning candidate % is not pending', p_candidate_id;
  end if;

  if not p_approve then
    update vip.learning_candidates
       set status = 'rejected',
           reviewer_id = p_reviewer_id,
           reviewer_notes = p_reviewer_notes,
           reviewed_at = now()
     where id = p_candidate_id;

    return p_candidate_id;
  end if;

  if candidate.candidate_type = 'create' then
    insert into vip.corpus_entries (
      tenant_id,
      pack_id,
      source_type,
      title,
      body,
      tags,
      evidence,
      metadata,
      created_by,
      updated_by
    )
    values (
      candidate.tenant_id,
      coalesce(candidate.proposed_metadata ->> 'pack_id', 'general'),
      'learning_candidate',
      coalesce(candidate.proposed_title, 'Learning entry'),
      coalesce(candidate.proposed_body, ''),
      coalesce(candidate.proposed_tags, '{}'),
      candidate.proposed_evidence,
      candidate.proposed_metadata || jsonb_build_object('snapshot_reason', 'approved_learning_candidate'),
      p_reviewer_id,
      p_reviewer_id
    )
    returning id into target_entry_id;
  elsif candidate.candidate_type = 'update' then
    if candidate.corpus_entry_id is null then
      raise exception 'update candidate requires corpus_entry_id';
    end if;

    update vip.corpus_entries
       set title = coalesce(candidate.proposed_title, title),
           body = coalesce(candidate.proposed_body, body),
           tags = coalesce(candidate.proposed_tags, tags),
           evidence = candidate.proposed_evidence,
           metadata = metadata || candidate.proposed_metadata || jsonb_build_object('snapshot_reason', 'approved_learning_candidate'),
           updated_by = p_reviewer_id
     where id = candidate.corpus_entry_id
     returning id into target_entry_id;
  elsif candidate.candidate_type = 'archive' then
    if candidate.corpus_entry_id is null then
      raise exception 'archive candidate requires corpus_entry_id';
    end if;

    update vip.corpus_entries
       set status = 'archived',
           metadata = metadata || jsonb_build_object('snapshot_reason', 'approved_learning_candidate'),
           updated_by = p_reviewer_id
     where id = candidate.corpus_entry_id
     returning id into target_entry_id;
  end if;

  update vip.learning_candidates
     set status = 'applied',
         reviewer_id = p_reviewer_id,
         reviewer_notes = p_reviewer_notes,
         reviewed_at = now(),
         applied_at = now()
   where id = p_candidate_id;

  return target_entry_id;
end;
$$;
