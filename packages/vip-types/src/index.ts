export type VIPMetadata = Record<string, unknown>;

export interface VIPActor {
  id: string;
  displayName?: string;
  role?: string;
}

export interface CorpusEntry {
  id: string;
  sourceType: string;
  title: string;
  content: string;
  tags?: string[];
  metadata?: VIPMetadata;
  updatedAt?: string;
}

export interface VIPContext {
  id: string;
  subject: string;
  actor?: VIPActor;
  corpus: CorpusEntry[];
  productSurface?: string;
  metadata?: VIPMetadata;
  createdAt: string;
}

export type ArtifactStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "published";

export interface Artifact {
  id: string;
  contextId: string;
  type: string;
  title: string;
  body: string;
  status: ArtifactStatus;
  metadata?: VIPMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequest {
  id: string;
  artifactId: string;
  requestedBy?: VIPActor;
  approvedBy?: VIPActor;
  status: "requested" | "approved" | "rejected";
  reason?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface FeedbackEvent {
  id: string;
  artifactId?: string;
  contextId?: string;
  actor?: VIPActor;
  body: string;
  category?: string;
  createsLearningUpdate: boolean;
  approvedForLearning: boolean;
  createdAt: string;
}

export interface DraftInput {
  context: VIPContext;
  artifactType: string;
  instructions?: string;
  metadata?: VIPMetadata;
}

export interface DraftResult {
  title: string;
  body: string;
  metadata?: VIPMetadata;
}

export interface PublishResult {
  publishedId: string;
  location?: string;
  metadata?: VIPMetadata;
}

export interface AuditEvent {
  id: string;
  action: string;
  actor?: VIPActor;
  artifactId?: string;
  contextId?: string;
  feedbackId?: string;
  approvalRequestId?: string;
  metadata?: VIPMetadata;
  createdAt: string;
}

export interface ReadContextInput {
  subject: string;
  actor?: VIPActor;
  productSurface?: string;
  metadata?: VIPMetadata;
}

export interface VIPApiTenantScope {
  tenant_id: string;
  organization_id?: string;
  traceId?: string;
}

export interface ReadContextApiRequest extends VIPApiTenantScope, ReadContextInput {}

export interface GenerateDraftApiRequest extends VIPApiTenantScope {
  subject: string;
  artifactType: string;
  instructions?: string;
  actor?: VIPActor;
  productSurface?: string;
  metadata?: VIPMetadata;
}

export interface CaptureFeedbackApiRequest extends VIPApiTenantScope {
  artifactId?: string;
  contextId?: string;
  body: string;
  category?: string;
  createsLearningUpdate?: boolean;
  approvedForLearning?: boolean;
  actor?: VIPActor;
}

export interface VIPApiErrorBody {
  traceId: string;
  error: {
    code: string;
    message: string;
    details?: VIPMetadata;
  };
}

export interface ContextResolver {
  read(input: ReadContextInput): Promise<Omit<VIPContext, "id" | "createdAt">>;
}

export interface DraftResolver {
  generate(input: DraftInput): Promise<DraftResult>;
}

export interface FeedbackResolver {
  capture(event: FeedbackEvent): Promise<FeedbackEvent>;
}

export interface ApprovalResolver {
  request(request: ApprovalRequest): Promise<ApprovalRequest>;
  resolve(request: ApprovalRequest): Promise<ApprovalRequest>;
}

export interface PublisherResolver {
  publish(artifact: Artifact): Promise<PublishResult>;
}

export interface AuditResolver {
  log(event: AuditEvent): Promise<AuditEvent>;
}

export interface IdResolver {
  createId(prefix: string): string;
}

export interface ClockResolver {
  now(): string;
}

export interface VIPResolvers {
  ids: IdResolver;
  clock: ClockResolver;
  context: ContextResolver;
  draft: DraftResolver;
  feedback: FeedbackResolver;
  approval: ApprovalResolver;
  publisher: PublisherResolver;
  audit: AuditResolver;
}
