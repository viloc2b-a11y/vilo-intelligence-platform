import { randomUUID } from "node:crypto";
import { captureFeedback, generateDraft, readContext } from "@vilo/vih-core";
import type {
  Artifact,
  CaptureFeedbackApiRequest,
  FeedbackEvent,
  GenerateDraftApiRequest,
  ReadContextApiRequest,
  VIPApiErrorBody,
  VIPContext,
  VIPMetadata,
  VIPResolvers
} from "@vilo/vip-types";

export interface RequestScope {
  tenantId: string;
  organizationId?: string;
  traceId: string;
}

export interface HealthMetrics {
  databaseReachable: boolean;
  vipSchemaInstalled: boolean;
  healthViewReadable: boolean;
  corpusCount: number;
  pendingArtifactApprovals: number;
  pendingLearningCandidates: number;
  latestAuditEventAt?: string | null;
  latestLearningJobAt?: string | null;
}

export interface ArtifactStore {
  createDraft(artifact: Artifact, scope: RequestScope): Promise<Artifact>;
}

export interface HealthReader {
  read(scope: Pick<RequestScope, "traceId">): Promise<HealthMetrics>;
}

export interface VIPHttpHandlerOptions {
  apiKey: string;
  createResolvers(scope: RequestScope): VIPResolvers;
  artifactStore: ArtifactStore;
  healthReader: HealthReader;
}

export function createVIPHttpHandler(options: VIPHttpHandlerOptions) {
  if (!options.apiKey) {
    throw new Error("VIP_API_KEY is required.");
  }

  return async function handleVIPRequest(request: Request): Promise<Response> {
    const traceId = request.headers.get("x-trace-id") ?? randomUUID();

    try {
      authorize(request, options.apiKey);

      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/health") {
        const health = await options.healthReader.read({ traceId });
        return json(200, { traceId, health });
      }

      if (request.method === "POST" && url.pathname === "/api/read-context") {
        const input = await parseJson<ReadContextApiRequest>(request);
        const scope = scopeFromInput(input, traceId);
        try {
          const context = await readContext(
            {
              subject: requireString(input.subject, "subject"),
              actor: input.actor,
              productSurface: input.productSurface,
              metadata: withServiceMetadata(input.metadata, scope)
            },
            { resolvers: options.createResolvers(scope) }
          );

          return json(200, { traceId: scope.traceId, context });
        } catch (error) {
          return toErrorResponse(error, scope.traceId);
        }
      }

      if (request.method === "POST" && url.pathname === "/api/generate-draft") {
        const input = await parseJson<GenerateDraftApiRequest>(request);
        const scope = scopeFromInput(input, traceId);
        try {
          const resolvers = options.createResolvers(scope);
          const context = await readContext(
            {
              subject: requireString(input.subject, "subject"),
              actor: input.actor,
              productSurface: input.productSurface,
              metadata: withServiceMetadata(input.metadata, scope)
            },
            { resolvers }
          );
          const draft = await generateDraft(
            {
              context,
              artifactType: requireString(input.artifactType, "artifactType"),
              instructions: input.instructions,
              metadata: withServiceMetadata(input.metadata, scope)
            },
            { resolvers }
          );
          const artifact = await options.artifactStore.createDraft(draft, scope);

          return json(201, { traceId: scope.traceId, context, artifact });
        } catch (error) {
          return toErrorResponse(error, scope.traceId);
        }
      }

      if (request.method === "POST" && url.pathname === "/api/capture-feedback") {
        const input = await parseJson<CaptureFeedbackApiRequest>(request);
        const scope = scopeFromInput(input, traceId);
        try {
          const feedback = await captureFeedback(
            {
              artifactId: input.artifactId,
              contextId: input.contextId,
              body: requireString(input.body, "body"),
              category: input.category,
              createsLearningUpdate: input.createsLearningUpdate,
              approvedForLearning: input.approvedForLearning,
              actor: input.actor
            },
            { resolvers: options.createResolvers(scope) }
          );

          return json(201, { traceId: scope.traceId, feedback });
        } catch (error) {
          return toErrorResponse(error, scope.traceId);
        }
      }

      return errorResponse(404, traceId, "not_found", "VIP API endpoint not found.");
    } catch (error) {
      return toErrorResponse(error, traceId);
    }
  };
}

function authorize(request: Request, expectedKey: string): void {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, key] = header.split(/\s+/, 2);

  if (scheme !== "Bearer" || key !== expectedKey) {
    throw new HttpError(401, "unauthorized", "A valid Authorization bearer token is required.");
  }
}

async function parseJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Request body must be JSON.");
  }

  try {
    const parsed = (await request.json()) as unknown;
    if (!isObject(parsed)) {
      throw new HttpError(400, "invalid_json", "Request body must be a JSON object.");
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, "invalid_json", "Request body could not be parsed.");
  }
}

function scopeFromInput(input: { tenant_id?: unknown; organization_id?: unknown; traceId?: unknown }, fallbackTraceId: string): RequestScope {
  return {
    tenantId: requireString(input.tenant_id, "tenant_id"),
    organizationId:
      typeof input.organization_id === "string" && input.organization_id.trim()
        ? input.organization_id
        : undefined,
    traceId: typeof input.traceId === "string" && input.traceId.trim() ? input.traceId : fallbackTraceId
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "invalid_request", `${field} is required.`);
  }

  return value;
}

function withServiceMetadata(metadata: VIPMetadata | undefined, scope: RequestScope): VIPMetadata {
  return {
    ...metadata,
    tenant_id: scope.tenantId,
    organization_id: scope.organizationId,
    traceId: scope.traceId
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toErrorResponse(error: unknown, traceId: string): Response {
  if (error instanceof HttpError) {
    return errorResponse(error.status, traceId, error.code, error.message, error.details);
  }

  const message = error instanceof Error ? error.message : "Unexpected VIP service error.";
  return errorResponse(500, traceId, "internal_error", message);
}

function errorResponse(
  status: number,
  traceId: string,
  code: string,
  message: string,
  details?: VIPMetadata
): Response {
  const body: VIPApiErrorBody = {
    traceId,
    error: {
      code,
      message,
      details
    }
  };
  return json(status, body);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: VIPMetadata
  ) {
    super(message);
  }
}

export type { FeedbackEvent, VIPContext };
