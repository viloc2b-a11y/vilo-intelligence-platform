import { randomUUID } from "node:crypto";
import { generateScreeningVisitSourceDraft } from "@vilo/vilo-os-document-intake";
import { loadDotEnvLocal } from "./env.js";

loadDotEnvLocal();

const tenantId = process.env.VIP_SMOKE_TENANT_ID ?? process.env.VIP_SMOKE_ORGANIZATION_ID;
const studyId = process.env.VIP_SMOKE_STUDY_ID ?? "document-intake-smoke-study";

if (!tenantId) {
  fail("VIP_SMOKE_TENANT_ID or VIP_SMOKE_ORGANIZATION_ID is required.");
}

const result = await generateScreeningVisitSourceDraft({
  tenant_id: tenantId,
  organization_id: process.env.VIP_SMOKE_ORGANIZATION_ID,
  study_id: studyId,
  protocolRuntimeStudyId: process.env.VIP_SMOKE_PROTOCOL_RUNTIME_STUDY_ID,
  traceId: `document-intake-smoke-${randomUUID()}`,
  documentContext: {
    source: "Document Intelligence",
    documentType: "screening_visit_source",
    extractedFields: {
      visitName: "Screening",
      consentRequired: true,
      baselineAssessments: ["eligibility", "medical history", "vitals"]
    }
  },
  protocolContext: {
    source: "Protocol Vault",
    study_id: studyId,
    protocolRuntimeStudyId: process.env.VIP_SMOKE_PROTOCOL_RUNTIME_STUDY_ID,
    visit: {
      name: "Screening",
      purpose: "Confirm eligibility before enrollment"
    }
  }
});

if (!result.vip.ok) {
  console.error(JSON.stringify(result, null, 2));
  fail(`Document Intake to VIP smoke returned fallback. Output saved to ${result.outputPath}`);
}

console.log("document-intake to VIP draft smoke passed");
console.log(`output: ${result.outputPath}`);
console.log(JSON.stringify(result.vip, null, 2));

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
