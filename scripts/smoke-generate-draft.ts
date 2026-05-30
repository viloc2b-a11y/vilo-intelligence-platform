import { randomUUID } from "node:crypto";
import { loadDotEnvLocal } from "./env.js";

loadDotEnvLocal();

const baseUrl = process.env.VIP_API_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;
const apiKey = process.env.VIP_API_KEY;
const tenantId = process.env.VIP_SMOKE_TENANT_ID;

if (!apiKey) {
  fail("VIP_API_KEY is required.");
}

if (!tenantId) {
  fail("VIP_SMOKE_TENANT_ID is required.");
}

const traceId = `smoke-${randomUUID()}`;
const response = await fetch(`${baseUrl}/api/generate-draft`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "x-trace-id": traceId
  },
  body: JSON.stringify({
    tenant_id: tenantId,
    organization_id: process.env.VIP_SMOKE_ORGANIZATION_ID,
    traceId,
    subject: "VIP HTTP smoke draft",
    artifactType: "smoke-brief",
    instructions: "Create a concise draft that proves the HTTP service can read context and persist a draft artifact.",
    productSurface: "smoke"
  })
});

const body = (await response.json()) as unknown;
if (!response.ok) {
  console.error(JSON.stringify(body, null, 2));
  fail(`generate-draft smoke failed with HTTP ${response.status}.`);
}

console.log("generate-draft smoke passed");
console.log(JSON.stringify(body, null, 2));

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
