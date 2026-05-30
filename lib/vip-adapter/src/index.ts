import { randomUUID } from "node:crypto";
import type { Artifact, VIPMetadata } from "@vilo/vip-types";

export interface VipDraftContext {
  tenant_id?: string;
  organization_id?: string;
  study_id?: string;
  protocolRuntimeStudyId?: string;
  documentContext?: VIPMetadata;
  protocolContext?: VIPMetadata;
}

export interface GenerateVipDraftInput extends VipDraftContext {
  subject?: string;
  artifactType?: string;
  instructions?: string;
  traceId?: string;
}

export interface VipAdapterOptions {
  apiUrl?: string;
  apiKey?: string;
  fetcher?: typeof fetch;
  logger?: Pick<Console, "warn">;
}

export type GenerateVipDraftResult =
  | {
      ok: true;
      traceId: string;
      artifact: Artifact;
      context?: unknown;
    }
  | {
      ok: false;
      traceId: string;
      fallback: {
        status: "draft_unavailable";
        reason: string;
        subject: string;
        artifactType: string;
        metadata: VIPMetadata;
      };
    };

interface VipGenerateDraftResponse {
  traceId?: string;
  artifact?: Artifact;
  context?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
}

const defaultArtifactType = "screening-visit-source-draft";

export async function generateVipDraft(
  input: GenerateVipDraftInput,
  options: VipAdapterOptions = {}
): Promise<GenerateVipDraftResult> {
  const traceId = input.traceId ?? `doc-intake-${randomUUID()}`;
  const artifactType = input.artifactType ?? defaultArtifactType;
  const subject = input.subject ?? defaultSubject(input);
  const metadata = contextMetadata(input, traceId);

  try {
    const apiUrl = options.apiUrl ?? process.env.VIP_API_URL ?? "http://localhost:8787";
    const apiKey = options.apiKey ?? process.env.VIP_API_KEY;
    const tenantId = input.tenant_id ?? input.organization_id;

    if (!apiKey) {
      throw new Error("VIP_API_KEY is required.");
    }
    if (!tenantId) {
      throw new Error("tenant_id or organization_id is required.");
    }

    const response = await (options.fetcher ?? fetch)(`${apiUrl}/api/generate-draft`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "x-trace-id": traceId
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        organization_id: input.organization_id,
        traceId,
        subject,
        artifactType,
        instructions: input.instructions ?? defaultInstructions(input),
        productSurface: "document-intelligence",
        metadata
      })
    });

    const body = (await response.json()) as VipGenerateDraftResponse;
    if (!response.ok) {
      throw new Error(body.error?.message ?? `VIP returned HTTP ${response.status}.`);
    }
    if (!body.artifact || body.artifact.status !== "draft") {
      throw new Error("VIP did not return a draft artifact.");
    }

    return {
      ok: true,
      traceId: body.traceId ?? traceId,
      artifact: body.artifact,
      context: body.context
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "VIP draft generation failed.";
    const fallback = {
      status: "draft_unavailable" as const,
      reason,
      subject,
      artifactType,
      metadata
    };
    (options.logger ?? console).warn(
      JSON.stringify({
        event: "vip_draft_fallback",
        traceId,
        reason
      })
    );

    return {
      ok: false,
      traceId,
      fallback
    };
  }
}

function defaultSubject(input: VipDraftContext): string {
  const study = input.study_id ?? input.protocolRuntimeStudyId ?? "current study";
  return `Screening visit source draft for ${study}`;
}

function defaultInstructions(input: VipDraftContext): string {
  return [
    "Generate an internal screening visit source draft from the current Document Intelligence and Protocol Vault context.",
    "Create a draft artifact only. Do not publish, approve, or mutate runtime objects.",
    input.study_id ? `Study ID: ${input.study_id}` : undefined,
    input.protocolRuntimeStudyId
      ? `Protocol runtime study ID: ${input.protocolRuntimeStudyId}`
      : undefined,
    stringifyContext("Document context", input.documentContext),
    stringifyContext("Protocol context", input.protocolContext)
  ]
    .filter(Boolean)
    .join("\n\n");
}

function contextMetadata(input: VipDraftContext, traceId: string): VIPMetadata {
  return {
    source: "document-intake",
    draftFlow: "screening-visit-source",
    organization_id: input.organization_id,
    study_id: input.study_id,
    protocolRuntimeStudyId: input.protocolRuntimeStudyId,
    documentContext: input.documentContext,
    protocolContext: input.protocolContext,
    traceId
  };
}

function stringifyContext(label: string, value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  return `${label}:\n${JSON.stringify(value, null, 2)}`;
}
