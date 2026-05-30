import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateVipDraft } from "@vilo/vip-adapter";
import { generateScreeningVisitSourceDraft } from "@vilo/vilo-os-document-intake";

test("generateVipDraft calls the VIP HTTP generate-draft path", async () => {
  const requests: unknown[] = [];
  const result = await generateVipDraft(
    {
      tenant_id: "tenant_1",
      organization_id: "org_1",
      study_id: "study_1",
      protocolRuntimeStudyId: "runtime_1",
      traceId: "trace_adapter",
      documentContext: { visit: "screening" },
      protocolContext: { visitWindow: "day -28 to day 0" }
    },
    {
      apiUrl: "http://vip.local",
      apiKey: "secret",
      fetcher: async (url, init) => {
        requests.push({ url, init });
        return Response.json({
          traceId: "trace_adapter",
          artifact: {
            id: "art_1",
            contextId: "ctx_1",
            type: "screening-visit-source-draft",
            title: "Screening draft",
            body: "Draft body",
            status: "draft",
            createdAt: "2026-05-29T12:00:00.000Z",
            updatedAt: "2026-05-29T12:00:00.000Z"
          }
        });
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  const request = requests[0] as { url: string; init: RequestInit };
  assert.equal(request.url, "http://vip.local/api/generate-draft");
  const body = JSON.parse(String(request.init.body));
  assert.equal(body.tenant_id, "tenant_1");
  assert.equal(body.organization_id, "org_1");
  assert.equal(body.metadata.study_id, "study_1");
  assert.equal(body.metadata.protocolRuntimeStudyId, "runtime_1");
});

test("generateVipDraft returns a controlled fallback when VIP fails", async () => {
  const warnings: string[] = [];
  const result = await generateVipDraft(
    {
      tenant_id: "tenant_1",
      traceId: "trace_fallback",
      study_id: "study_1"
    },
    {
      apiUrl: "http://vip.local",
      apiKey: "secret",
      logger: {
        warn(message) {
          warnings.push(message);
        }
      },
      fetcher: async () =>
        Response.json(
          {
            traceId: "trace_fallback",
            error: {
              code: "internal_error",
              message: "VIP unavailable"
            }
          },
          { status: 500 }
        )
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.traceId, "trace_fallback");
  assert.equal(result.fallback.status, "draft_unavailable");
  assert.match(result.fallback.reason, /VIP unavailable/);
  assert.equal(warnings.length, 1);
});

test("Document Intake bridge saves VIP draft smoke output without mutating runtime context", async () => {
  const documentContext = { fields: { visit: "screening" } };
  const protocolContext = { visit: { name: "Screening" } };
  const outputDir = await mkdtemp(join(tmpdir(), "vip-doc-intake-"));

  const result = await generateScreeningVisitSourceDraft(
    {
      tenant_id: "tenant_1",
      organization_id: "org_1",
      study_id: "study_1",
      protocolRuntimeStudyId: "runtime_1",
      traceId: "trace_doc_intake",
      documentContext,
      protocolContext,
      outputDir
    },
    {
      apiUrl: "http://vip.local",
      apiKey: "secret",
      fetcher: async () =>
        Response.json({
          traceId: "trace_doc_intake",
          artifact: {
            id: "art_1",
            contextId: "ctx_1",
            type: "screening-visit-source-draft",
            title: "Screening draft",
            body: "Draft body",
            status: "draft",
            createdAt: "2026-05-29T12:00:00.000Z",
            updatedAt: "2026-05-29T12:00:00.000Z"
          }
        })
    }
  );

  const saved = JSON.parse(await readFile(result.outputPath, "utf8"));
  assert.equal(result.vip.ok, true);
  assert.equal(saved.traceId, "trace_doc_intake");
  assert.deepEqual(documentContext, { fields: { visit: "screening" } });
  assert.deepEqual(protocolContext, { visit: { name: "Screening" } });
});
