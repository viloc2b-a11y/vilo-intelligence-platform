-- VIP production SQL foundation: validation, idempotency, locking, and observability.
-- Apply manually after vip-memory.sql.

create or replace function vip.validate_evidence_array(p_evidence jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p_evidence) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(p_evidence) item
      where jsonb_typeof(item) <> 'object'
         or not (item ? 'source_type')
         or not (item ? 'source_id')
         or not (item ? 'quote')
    )
$$;

alter table vip.corpus_entries
  add constraint corpus_entries_evidence_is_structured
  check (vip.validate_evidence_array(evidence)) not valid;

alter table vip.artifacts
  add constraint artifacts_evidence_is_structured
  check (vip.validate_evidence_array(evidence)) not valid;

alter table vip.learning_candidates
  add constraint learning_candidates_evidence_is_structured
  check (vip.validate_evidence_array(proposed_evidence)) not valid;

alter table vip.artifacts
  add constraint artifacts_fallback_requires_override_reason
  check (
    status <> 'fallback_pending'
    or nullif(metadata ->> 'reviewer_override_reason', '') is not null
  ) not valid;

alter table vip.approvals
  add constraint approvals_fallback_requires_override_reason
  check (
    coalesce(metadata ->> 'approval_mode', '') <> 'fallback'
    or nullif(reviewer_override_reason, '') is not null
  ) not valid;

create unique index if not exists learning_candidates_one_pending_per_feedback
  on vip.learning_candidates (feedback_id)
  where feedback_id is not null and status = 'pending';

create unique index if not exists learning_candidates_one_pending_per_entry_type
  on vip.learning_candidates (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    corpus_entry_id,
    candidate_type
  )
  where corpus_entry_id is not null and status = 'pending';

create unique index if not exists artifacts_tenant_idempotency_key_idx
  on vip.artifacts (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    idempotency_key
  )
  where idempotency_key is not null;

create unique index if not exists learning_candidates_tenant_idempotency_key_idx
  on vip.learning_candidates (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    idempotency_key
  )
  where idempotency_key is not null;

create or replace function vip.audit_artifact_fallback()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'fallback_pending' and old.status is distinct from new.status then
    insert into vip.audit_log (tenant_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (
      new.tenant_id,
      new.approved_by,
      'fallback_artifact_approval_requested',
      'artifact',
      new.id,
      jsonb_build_object('reviewer_override_reason', new.metadata ->> 'reviewer_override_reason')
    );
  end if;

  return new;
end;
$$;

create trigger audit_artifact_fallback
after update on vip.artifacts
for each row execute function vip.audit_artifact_fallback();

create or replace function vip.audit_learning_candidate_review()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'pending' and new.status in ('rejected', 'applied') then
    insert into vip.audit_log (tenant_id, actor_id, event_type, entity_type, entity_id, metadata)
    values (
      new.tenant_id,
      new.reviewer_id,
      case
        when new.status = 'applied' then 'learning_candidate_approved'
        else 'learning_candidate_rejected'
      end,
      'learning_candidate',
      new.id,
      jsonb_build_object('reviewer_notes', new.reviewer_notes)
    );
  end if;

  return new;
end;
$$;

create trigger audit_learning_candidate_review
after update on vip.learning_candidates
for each row execute function vip.audit_learning_candidate_review();

create or replace function vip.run_learning_job(p_tenant_id uuid default vip.current_tenant_id())
returns uuid
language plpgsql
as $$
declare
  job_id uuid;
  candidate_count integer;
  lock_key bigint;
begin
  lock_key := hashtextextended('vip.run_learning_job:' || coalesce(p_tenant_id::text, 'platform'), 0);

  if not pg_try_advisory_xact_lock(lock_key) then
    insert into vip.job_runs (tenant_id, job_name, status, finished_at, metadata)
    values (p_tenant_id, 'learning', 'skipped', now(), jsonb_build_object('reason', 'advisory_lock_not_acquired'))
    returning id into job_id;

    insert into vip.audit_log (tenant_id, event_type, entity_type, entity_id, metadata)
    values (p_tenant_id, 'learning_job_skipped', 'job_run', job_id, jsonb_build_object('reason', 'advisory_lock_not_acquired'));

    return job_id;
  end if;

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
    )
  on conflict do nothing;

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

      insert into vip.audit_log (tenant_id, event_type, entity_type, entity_id, metadata)
      values (p_tenant_id, 'learning_job_failed', 'job_run', job_id, jsonb_build_object('error', sqlerrm));
    end if;
    raise;
end;
$$;

create or replace view vip.v_health as
select
  (select count(*) from vip.corpus_entries) as corpus_entries,
  (select count(*) from vip.artifacts where status = 'pending_approval') as pending_artifact_approvals,
  (select count(*) from vip.learning_candidates where status = 'pending') as pending_learning_candidates,
  (select max(created_at) from vip.audit_log) as latest_audit_event_at,
  (select max(started_at) from vip.job_runs where job_name = 'learning') as latest_learning_job_at;

create or replace view vip.v_stale_packs as
select
  pack_id,
  tenant_id,
  count(*) as entry_count,
  max(updated_at) as latest_entry_update_at
from vip.corpus_entries
where status = 'active'
group by pack_id, tenant_id
having max(updated_at) < now() - interval '90 days';

create or replace view vip.v_reviewer_activity as
select
  reviewer_id,
  tenant_id,
  count(*) filter (where status = 'approved') as artifact_approvals,
  count(*) filter (where status = 'rejected') as artifact_rejections,
  max(resolved_at) as latest_artifact_review_at
from vip.approvals
where reviewer_id is not null
group by reviewer_id, tenant_id;
