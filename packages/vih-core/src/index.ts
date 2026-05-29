import type {
  ApprovalRequest,
  Artifact,
  AuditEvent,
  FeedbackEvent,
  ReadContextInput,
  VIPContext,
  VIPMetadata,
  VIPResolvers
} from "@vilo/vip-types";

export interface CoreOptions {
  resolvers: VIPResolvers;
}

export interface GenerateDraftInput {
  context: VIPContext;
  artifactType: string;
  instructions?: string;
  metadata?: VIPMetadata;
}

export interface CaptureFeedbackInput {
  artifactId?: string;
  contextId?: string;
  body: string;
  category?: string;
  createsLearningUpdate?: boolean;
  approvedForLearning?: boolean;
  actor?: FeedbackEvent["actor"];
}

export interface ApproveArtifactInput {
  artifact: Artifact;
  requestedBy?: ApprovalRequest["requestedBy"];
  approvedBy?: ApprovalRequest["approvedBy"];
  reason?: string;
}

export async function readContext(
  input: ReadContextInput,
  options: CoreOptions
): Promise<VIPContext> {
  const resolved = await options.resolvers.context.read(input);
  return {
    ...resolved,
    id: options.resolvers.ids.createId("ctx"),
    createdAt: options.resolvers.clock.now()
  };
}

export async function generateDraft(
  input: GenerateDraftInput,
  options: CoreOptions
): Promise<Artifact> {
  const now = options.resolvers.clock.now();
  const draft = await options.resolvers.draft.generate({
    context: input.context,
    artifactType: input.artifactType,
    instructions: input.instructions,
    metadata: input.metadata
  });

  return {
    id: options.resolvers.ids.createId("art"),
    contextId: input.context.id,
    type: input.artifactType,
    title: draft.title,
    body: draft.body,
    status: "draft",
    metadata: {
      ...input.metadata,
      ...draft.metadata
    },
    createdAt: now,
    updatedAt: now
  };
}

export async function captureFeedback(
  input: CaptureFeedbackInput,
  options: CoreOptions
): Promise<FeedbackEvent> {
  if (input.createsLearningUpdate && !input.approvedForLearning) {
    throw new Error("Human approval is required before recording a learning update.");
  }

  const event: FeedbackEvent = {
    id: options.resolvers.ids.createId("fb"),
    artifactId: input.artifactId,
    contextId: input.contextId,
    actor: input.actor,
    body: input.body,
    category: input.category,
    createsLearningUpdate: input.createsLearningUpdate ?? false,
    approvedForLearning: input.approvedForLearning ?? false,
    createdAt: options.resolvers.clock.now()
  };

  return options.resolvers.feedback.capture(event);
}

export async function approveArtifact(
  input: ApproveArtifactInput,
  options: CoreOptions
): Promise<{ artifact: Artifact; approval: ApprovalRequest }> {
  const now = options.resolvers.clock.now();
  const request: ApprovalRequest = {
    id: options.resolvers.ids.createId("apr"),
    artifactId: input.artifact.id,
    requestedBy: input.requestedBy,
    approvedBy: input.approvedBy,
    status: "approved",
    reason: input.reason,
    createdAt: now,
    resolvedAt: now
  };

  const approval = await options.resolvers.approval.resolve(request);
  return {
    approval,
    artifact: {
      ...input.artifact,
      status: "approved",
      updatedAt: now
    }
  };
}

export async function publishArtifact(
  artifact: Artifact,
  options: CoreOptions
): Promise<Artifact> {
  if (artifact.status !== "approved") {
    throw new Error("Human approval is required before publishing artifacts.");
  }

  await options.resolvers.publisher.publish(artifact);
  return {
    ...artifact,
    status: "published",
    updatedAt: options.resolvers.clock.now()
  };
}

export async function logAudit(
  event: Omit<AuditEvent, "id" | "createdAt">,
  options: CoreOptions
): Promise<AuditEvent> {
  return options.resolvers.audit.log({
    ...event,
    id: options.resolvers.ids.createId("aud"),
    createdAt: options.resolvers.clock.now()
  });
}
