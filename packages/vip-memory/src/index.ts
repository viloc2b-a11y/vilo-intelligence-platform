import type { VIPActor, VIPMetadata } from "@vilo/vip-types";

export type MemoryScope =
  | "platform"
  | "product"
  | "tenant"
  | "study"
  | "user"
  | "relationship"
  | "project";

export type MemoryCategory =
  | "preference"
  | "decision"
  | "constraint"
  | "assumption"
  | "convention"
  | "relationship_context"
  | "operational_context"
  | "compliance_context";

export type MemorySource =
  | "human"
  | "approved_feedback"
  | "approved_artifact"
  | "system_import"
  | "resolver";

export type MemoryConfidence = number;

export type MemoryStatus = "active" | "archived" | "superseded";

export interface MemoryEntry {
  id: string;
  tenantId?: string | null;
  scope: MemoryScope;
  category: MemoryCategory;
  content: string;
  metadata?: VIPMetadata;
  confidence: MemoryConfidence;
  sourceType: MemorySource | string;
  sourceRefId?: string;
  status: MemoryStatus;
  validFrom?: string;
  validUntil?: string;
  createdBy?: VIPActor;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryEvent {
  id: string;
  memoryId: string;
  tenantId?: string | null;
  actor?: VIPActor;
  eventType: "remembered" | "recalled" | "updated" | "archived";
  metadata?: VIPMetadata;
  createdAt: string;
}

export interface RememberInput {
  tenantId?: string | null;
  scope: MemoryScope;
  category: MemoryCategory;
  content: string;
  metadata?: VIPMetadata;
  confidence?: MemoryConfidence;
  sourceType: MemorySource | string;
  sourceRefId?: string;
  validFrom?: string;
  validUntil?: string;
  actor?: VIPActor;
}

export interface RecallInput {
  tenantId?: string | null;
  scopes?: MemoryScope[];
  categories?: MemoryCategory[];
  query?: string;
  now?: string;
  includePlatform?: boolean;
  limit?: number;
  actor?: VIPActor;
}

export interface UpdateMemoryInput {
  id: string;
  content?: string;
  metadata?: VIPMetadata;
  confidence?: MemoryConfidence;
  validFrom?: string;
  validUntil?: string;
  actor?: VIPActor;
  supersedesMemoryId?: string;
}

export interface ArchiveMemoryInput {
  id: string;
  actor?: VIPActor;
  reason?: string;
}

export interface MemoryResolver {
  create(entry: MemoryEntry): Promise<MemoryEntry>;
  recall(input: RecallInput): Promise<MemoryEntry[]>;
  update(entry: MemoryEntry): Promise<MemoryEntry>;
  getById(id: string): Promise<MemoryEntry | null>;
}

export interface MemoryEventResolver {
  append(event: MemoryEvent): Promise<MemoryEvent>;
}

export interface MemoryIdResolver {
  createId(prefix: string): string;
}

export interface MemoryClockResolver {
  now(): string;
}

export interface MemoryResolvers {
  ids: MemoryIdResolver;
  clock: MemoryClockResolver;
  memory: MemoryResolver;
  events: MemoryEventResolver;
}

export interface MemoryOptions {
  resolvers: MemoryResolvers;
}

export async function remember(input: RememberInput, options: MemoryOptions): Promise<MemoryEntry> {
  assertContent(input.content);
  assertConfidence(input.confidence);

  const now = options.resolvers.clock.now();
  const entry: MemoryEntry = {
    id: options.resolvers.ids.createId("mem"),
    tenantId: input.tenantId ?? null,
    scope: input.scope,
    category: input.category,
    content: input.content,
    metadata: withMemoryRules(input.metadata),
    confidence: input.confidence ?? 1,
    sourceType: input.sourceType,
    sourceRefId: input.sourceRefId,
    status: "active",
    validFrom: input.validFrom ?? now,
    validUntil: input.validUntil,
    createdBy: input.actor,
    createdAt: now,
    updatedAt: now
  };

  const created = await options.resolvers.memory.create(entry);
  await appendMemoryEvent(created, "remembered", options, input.actor, {
    sourceType: input.sourceType,
    sourceRefId: input.sourceRefId
  });

  return created;
}

export async function recall(input: RecallInput, options: MemoryOptions): Promise<MemoryEntry[]> {
  const recalled = await options.resolvers.memory.recall({
    ...input,
    now: input.now ?? options.resolvers.clock.now(),
    includePlatform: input.includePlatform ?? true
  });

  await Promise.all(
    recalled.map((entry) =>
      appendMemoryEvent(entry, "recalled", options, input.actor, {
        query: input.query
      })
    )
  );

  return recalled;
}

export async function updateMemory(
  input: UpdateMemoryInput,
  options: MemoryOptions
): Promise<MemoryEntry> {
  if (input.content !== undefined) {
    assertContent(input.content);
  }
  assertConfidence(input.confidence);

  const existing = await options.resolvers.memory.getById(input.id);
  if (!existing) {
    throw new Error(`Memory entry not found: ${input.id}`);
  }
  if (existing.status !== "active") {
    throw new Error("Only active memory entries can be updated.");
  }

  const updated: MemoryEntry = {
    ...existing,
    content: input.content ?? existing.content,
    metadata: withMemoryRules({
      ...existing.metadata,
      ...input.metadata,
      supersedesMemoryId: input.supersedesMemoryId
    }),
    confidence: input.confidence ?? existing.confidence,
    validFrom: input.validFrom ?? existing.validFrom,
    validUntil: input.validUntil ?? existing.validUntil,
    updatedAt: options.resolvers.clock.now()
  };

  const saved = await options.resolvers.memory.update(updated);
  await appendMemoryEvent(saved, "updated", options, input.actor, {
    supersedesMemoryId: input.supersedesMemoryId
  });

  return saved;
}

export async function archiveMemory(
  input: ArchiveMemoryInput,
  options: MemoryOptions
): Promise<MemoryEntry> {
  const existing = await options.resolvers.memory.getById(input.id);
  if (!existing) {
    throw new Error(`Memory entry not found: ${input.id}`);
  }

  const archived: MemoryEntry = {
    ...existing,
    status: "archived",
    metadata: {
      ...existing.metadata,
      archiveReason: input.reason
    },
    updatedAt: options.resolvers.clock.now()
  };

  const saved = await options.resolvers.memory.update(archived);
  await appendMemoryEvent(saved, "archived", options, input.actor, {
    reason: input.reason
  });

  return saved;
}

function assertContent(content: string): void {
  if (content.trim().length === 0) {
    throw new Error("Memory content is required.");
  }
}

function assertConfidence(confidence: MemoryConfidence | undefined): void {
  if (confidence === undefined) {
    return;
  }

  if (confidence < 0 || confidence > 1) {
    throw new Error("Memory confidence must be between 0 and 1.");
  }
}

function withMemoryRules(metadata: VIPMetadata | undefined): VIPMetadata {
  return {
    ...metadata,
    memoryRules: {
      isCorpus: false,
      createsProceduralPattern: false,
      canInformGenerationContext: true,
      cannotOverrideProtocolSafetyComplianceOrApprovedRuntimeData: true
    }
  };
}

async function appendMemoryEvent(
  entry: MemoryEntry,
  eventType: MemoryEvent["eventType"],
  options: MemoryOptions,
  actor: VIPActor | undefined,
  metadata: VIPMetadata
): Promise<void> {
  await options.resolvers.events.append({
    id: options.resolvers.ids.createId("mev"),
    memoryId: entry.id,
    tenantId: entry.tenantId,
    actor,
    eventType,
    metadata,
    createdAt: options.resolvers.clock.now()
  });
}
