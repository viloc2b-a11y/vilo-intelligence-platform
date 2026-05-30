import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateVipDraft, type GenerateVipDraftResult, type VipAdapterOptions } from "@vilo/vip-adapter";
import type { VIPMetadata } from "@vilo/vip-types";

export interface DocumentIntakeVipDraftInput {
  tenant_id?: string;
  organization_id?: string;
  study_id: string;
  protocolRuntimeStudyId?: string;
  traceId?: string;
  documentContext: VIPMetadata;
  protocolContext?: VIPMetadata;
  outputDir?: string;
}

export interface DocumentIntakeVipDraftResult {
  traceId: string;
  vip: GenerateVipDraftResult;
  outputPath: string;
}

export async function generateScreeningVisitSourceDraft(
  input: DocumentIntakeVipDraftInput,
  options: VipAdapterOptions = {}
): Promise<DocumentIntakeVipDraftResult> {
  const vip = await generateVipDraft(
    {
      tenant_id: input.tenant_id,
      organization_id: input.organization_id,
      study_id: input.study_id,
      protocolRuntimeStudyId: input.protocolRuntimeStudyId,
      traceId: input.traceId,
      documentContext: input.documentContext,
      protocolContext: input.protocolContext,
      artifactType: "screening-visit-source-draft"
    },
    options
  );
  const outputPath = await persistDraftSmokeOutput(input.outputDir ?? "tmp", vip);

  return {
    traceId: vip.traceId,
    vip,
    outputPath
  };
}

async function persistDraftSmokeOutput(
  outputDir: string,
  vip: GenerateVipDraftResult
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `document-intake-vip-draft-${vip.traceId}.json`);
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        traceId: vip.traceId,
        createdAt: new Date().toISOString(),
        draft: vip
      },
      null,
      2
    )
  );

  return outputPath;
}
