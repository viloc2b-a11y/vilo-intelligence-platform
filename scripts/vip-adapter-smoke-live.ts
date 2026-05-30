import { generateVipDraft } from "@vilo/vip-adapter";
import { loadDotEnvLocal } from "./env.js";

loadDotEnvLocal();

const tenantId = process.env.VIP_SMOKE_TENANT_ID ?? process.env.VIP_SMOKE_ORGANIZATION_ID;
if (!tenantId) {
  fail("VIP_SMOKE_TENANT_ID or VIP_SMOKE_ORGANIZATION_ID is required.");
}

const result = await generateVipDraft({
  tenant_id: tenantId,
  organization_id: process.env.VIP_SMOKE_ORGANIZATION_ID,
  study_id: process.env.VIP_SMOKE_STUDY_ID ?? "vip-adapter-smoke-study",
  protocolRuntimeStudyId: process.env.VIP_SMOKE_PROTOCOL_RUNTIME_STUDY_ID,
  documentContext: {
    source: "vip-adapter-smoke",
    documentType: "screening_visit_source"
  },
  protocolContext: {
    source: "vip-adapter-smoke",
    visit: "screening"
  }
});

if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  fail("VIP adapter live smoke returned fallback.");
}

console.log("vip-adapter live smoke passed");
console.log(JSON.stringify(result, null, 2));

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
