import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Artifact,
  AuditEvent,
  CorpusEntry,
  DraftInput,
  FeedbackEvent,
  VIPMetadata,
  VIPResolvers
} from "@vilo/vip-types";
import type { ArtifactStore, HealthMetrics, HealthReader, RequestScope } from "./http.js";

export interface SupabaseVIPServiceOptions {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

interface SupabaseVIPService {
  createResolvers(scope: RequestScope): VIPResolvers;
  artifactStore: ArtifactStore;
  healthReader: HealthReader;
}

interface HealthRow {
  corpus_entries?: number;
  pending_artifact_approvals?: number;
  pending_learning_candidates?: number;
  latest_audit_event_at?: string | null;
  latest_learning_job_at?: string | null;
}

type Row = Record<string, unknown>;
type VIPSupabaseClient = SupabaseClient<any, any, any>;

export function createSupabaseVIPService(options: SupabaseVIPServiceOptions): SupabaseVIPService {
  const supabase = createClient(options.supabaseUrl, options.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    db: {
      schema: "vip"
    }
  });

  return {
    createResolvers(scope) {
      return createSupabaseResolvers(supabase, scope);
    },
    artifactStore: createArtifactStore(supabase),
    healthReader: createHealthReader(supabase)
  };
}

function createSupabaseResolvers(supabase: VIPSupabaseClient, scope: RequestScope): VIPResolvers {
  return {
    ids: {
      createId() {
        return randomUUID();
      }
    },
    clock: {
      now() {
        return new Date().toISOString();
      }
    },
    context: {
      async read(input) {
        const corpus = await readCorpus(supabase, scope);
        return {
          subject: input.subject,
          actor: input.actor,
          productSurface: input.productSurface,
          metadata: input.metadata,
          corpus
        };
      }
    },
    draft: {
      async generate(input) {
        return renderDraft(input, scope);
      }
    },
    feedback: {
      async capture(event) {
        const insert = {
          id: event.id,
          tenant_id: scope.tenantId,
          artifact_id: event.artifactId ?? null,
          reviewer_id: isUuid(event.actor?.id) ? event.actor?.id : null,
          body: event.body,
          category: event.category ?? null,
          creates_learning_candidate: event.createsLearningUpdate,
          metadata: {
            contextId: event.contextId,
            actor: event.actor,
            approvedForLearning: event.approvedForLearning,
            organization_id: scope.organizationId,
            traceId: scope.traceId
          }
        };
        const result = await supabase.from("feedback").insert(insert).select("*").single();
        if (result.error) {
          throw new Error(`Could not capture VIP feedback: ${sanitize(result.error.message)}`);
        }
        return event;
      }
    },
    approval: {
      async request(request) {
        return request;
      },
      async resolve(request) {
        return request;
      }
    },
    publisher: {
      async publish() {
        throw new Error("Publishing is not available from the VIP HTTP service.");
      }
    },
    audit: {
      async log(event) {
        await insertAuditEvent(supabase, scope, event);
        return event;
      }
    }
  };
}

function createArtifactStore(supabase: VIPSupabaseClient): ArtifactStore {
  return {
    async createDraft(artifact, scope) {
      const metadata = {
        ...artifact.metadata,
        organization_id: scope.organizationId,
        traceId: scope.traceId
      };
      
      const idempotencyKey = typeof artifact.metadata?.idempotencyKey === "string" 
        ? artifact.metadata.idempotencyKey 
        : null;

      const result = await supabase
        .from("artifacts")
        .insert({
          id: artifact.id,
          tenant_id: scope.tenantId,
          context_id: artifact.contextId,
          idempotency_key: idempotencyKey,
          artifact_type: artifact.type,
          title: artifact.title,
          body: artifact.body,
          metadata,
          status: "draft"
        })
        .select("*")
        .maybeSingle();

      if (result.error) {
        if (result.error.code === "23505" && result.error.message.includes("artifacts_tenant_id_idempotency_key_key")) {
          let query = supabase.from("artifacts").select("*").eq("tenant_id", scope.tenantId);
          if (idempotencyKey === null) {
            query = query.is("idempotency_key", null);
          } else {
            query = query.eq("idempotency_key", idempotencyKey);
          }
          const existing = await query.single();
          
          if (existing.data) {
            return {
              id: String(existing.data.id),
              contextId: String(existing.data.context_id),
              type: String(existing.data.artifact_type),
              title: String(existing.data.title),
              body: String(existing.data.body),
              status: existing.data.status as Artifact["status"],
              metadata: isMetadata(existing.data.metadata) ? existing.data.metadata : undefined,
              createdAt: typeof existing.data.created_at === "string" ? existing.data.created_at : artifact.createdAt,
              updatedAt: typeof existing.data.updated_at === "string" ? existing.data.updated_at : artifact.updatedAt
            };
          }
        }
        
        throw new Error(`Could not create VIP draft artifact: ${sanitize(result.error.message)}`);
      }

      return {
        ...artifact,
        metadata
      };
    }
  };
}

function createHealthReader(supabase: VIPSupabaseClient): HealthReader {
  return {
    async read() {
      const healthResult = await supabase.from("v_health").select("*").limit(1).maybeSingle();
      if (healthResult.error) {
        throw new Error(
          `Could not read vip.v_health. Confirm VIP SQL is installed: ${sanitize(
            healthResult.error.message
          )}`
        );
      }

      const countResult = await supabase
        .from("corpus_entries")
        .select("id", { count: "exact", head: true });

      if (countResult.error) {
        throw new Error(
          `Could not query vip.corpus_entries. Confirm VIP schema access: ${sanitize(
            countResult.error.message
          )}`
        );
      }

      const health = healthResult.data as HealthRow | null;
      return {
        databaseReachable: true,
        vipSchemaInstalled: true,
        healthViewReadable: true,
        corpusCount: countResult.count ?? health?.corpus_entries ?? 0,
        pendingArtifactApprovals: health?.pending_artifact_approvals ?? 0,
        pendingLearningCandidates: health?.pending_learning_candidates ?? 0,
        latestAuditEventAt: health?.latest_audit_event_at ?? null,
        latestLearningJobAt: health?.latest_learning_job_at ?? null
      } satisfies HealthMetrics;
    }
  };
}

async function readCorpus(supabase: VIPSupabaseClient, scope: RequestScope): Promise<CorpusEntry[]> {
  const ranked = await selectCorpusRows(supabase, "v_corpus_ranked", scope);
  if (ranked.ok) {
    return ranked.rows.map(toCorpusEntry);
  }

  const fallback = await selectCorpusRows(supabase, "corpus_entries", scope);
  if (!fallback.ok) {
    throw new Error(`Could not read VIP corpus: ${sanitize(fallback.message)}`);
  }

  return fallback.rows.map(toCorpusEntry);
}

async function selectCorpusRows(
  supabase: VIPSupabaseClient,
  table: string,
  scope: RequestScope
): Promise<{ ok: true; rows: Row[] } | { ok: false; message: string }> {
  const result = await supabase
    .from(table)
    .select("*")
    .or(`tenant_id.is.null,tenant_id.eq.${scope.tenantId}`)
    .limit(10);

  if (result.error) {
    return { ok: false, message: result.error.message };
  }

  return { ok: true, rows: (result.data ?? []) as Row[] };
}

function renderDraft(input: DraftInput, scope: RequestScope) {
  const sources = input.context.corpus.slice(0, 5);
  const sourceSummary =
    sources.length > 0
      ? sources.map((entry, index) => `${index + 1}. ${entry.title}: ${entry.content}`).join("\n")
      : "No corpus entries were available for this tenant.";
  const instructions = input.instructions ? `\nInstructions:\n${input.instructions}\n` : "";

  return {
    title: `${input.artifactType} draft for ${input.context.subject}`,
    body: [
      `Subject: ${input.context.subject}`,
      `Artifact type: ${input.artifactType}`,
      instructions.trim(),
      "Draft basis:",
      sourceSummary,
      "Review status: draft artifact only; human approval is required before publication."
    ]
      .filter(Boolean)
      .join("\n\n"),
    metadata: {
      generatedBy: "vip-http-service",
      corpusEntryIds: sources.map((entry) => entry.id),
      organization_id: scope.organizationId,
      traceId: scope.traceId
    }
  };
}

async function insertAuditEvent(
  supabase: VIPSupabaseClient,
  scope: RequestScope,
  event: AuditEvent
): Promise<void> {
  const result = await supabase.from("audit_log").insert({
    id: event.id,
    tenant_id: scope.tenantId,
    actor_id: isUuid(event.actor?.id) ? event.actor?.id : null,
    event_type: event.action,
    entity_type: auditEntityType(event),
    entity_id: firstUuid(event.artifactId, event.feedbackId, event.approvalRequestId),
    metadata: {
      ...event.metadata,
      contextId: event.contextId,
      traceId: scope.traceId
    }
  });

  if (result.error) {
    throw new Error(`Could not write VIP audit event: ${sanitize(result.error.message)}`);
  }
}

function toCorpusEntry(row: Row): CorpusEntry {
  return {
    id: String(row.id),
    sourceType: String(row.source_type ?? row.sourceType ?? "corpus"),
    title: String(row.title ?? "Untitled corpus entry"),
    content: String(row.body ?? row.content ?? ""),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    metadata: isMetadata(row.metadata) ? row.metadata : {},
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined
  };
}

function auditEntityType(event: AuditEvent): string {
  if (event.artifactId) {
    return "artifact";
  }
  if (event.feedbackId) {
    return "feedback";
  }
  if (event.approvalRequestId) {
    return "approval";
  }
  return "context";
}

function firstUuid(...values: Array<string | undefined>): string | null {
  return values.find((value): value is string => isUuid(value)) ?? null;
}

function isUuid(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function isMetadata(value: unknown): value is VIPMetadata {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitize(message: string): string {
  return message
    .replace(/service_role_[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/eyJ[A-Za-z0-9._-]+/g, "[redacted]");
}
