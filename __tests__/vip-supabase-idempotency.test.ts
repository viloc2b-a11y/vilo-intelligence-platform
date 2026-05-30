import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseVIPService } from "@vilo/vip-service";

test("Supabase createDraft handles duplicate idempotency key by returning existing artifact", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let insertCount = 0;
  let selectCount = 0;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    
    // Intercept POST /rest/v1/artifacts (the insert)
    if (url.includes("/artifacts") && init?.method === "POST") {
      insertCount++;
      // Return 409 Conflict with unique constraint violation
      return Response.json(
        {
          code: "23505",
          message: 'duplicate key value violates unique constraint "artifacts_tenant_id_idempotency_key_key"',
          details: null
        },
        { status: 409 }
      );
    }
    
    // Intercept GET /rest/v1/artifacts (the fallback select)
    if (url.includes("/artifacts") && init?.method === "GET") {
      selectCount++;
      return Response.json(
        {
          id: "existing-id",
          context_id: "ctx_1",
          artifact_type: "smoke",
          title: "Existing",
          body: "Existing body",
          status: "draft",
          metadata: { idempotencyKey: "123" },
          created_at: "2026-05-29T12:00:00Z",
          updated_at: "2026-05-29T12:00:00Z"
        }, { status: 200 });
    }
    
    return Response.json({}, { status: 200 });
  };

  const service = createSupabaseVIPService({
    supabaseUrl: "http://mock.local",
    supabaseServiceRoleKey: "secret"
  });

  const artifact = await service.artifactStore.createDraft(
    {
      id: "new-id",
      contextId: "ctx_1",
      type: "smoke",
      title: "New",
      body: "New body",
      status: "draft",
      metadata: { idempotencyKey: "123" },
      createdAt: "2026-05-30T12:00:00Z",
      updatedAt: "2026-05-30T12:00:00Z"
    },
    { tenantId: "tenant_1", traceId: "trace_1" }
  );

  assert.equal(insertCount, 1, "Should attempt insert once");
  assert.equal(selectCount, 1, "Should attempt select fallback once");
  assert.equal(artifact.id, "existing-id", "Should return the existing artifact ID");
  assert.equal(artifact.title, "Existing", "Should return the existing artifact title");
});
