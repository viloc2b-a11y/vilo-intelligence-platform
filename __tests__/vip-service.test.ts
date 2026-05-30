import assert from "node:assert/strict";
import test from "node:test";
import { createVIPHttpHandler, type ArtifactStore, type HealthReader } from "@vilo/vip-service";
import type { VIPResolvers } from "@vilo/vip-types";

function createMockResolvers(): VIPResolvers {
  let sequence = 0;
  return {
    ids: {
      createId(prefix) {
        sequence += 1;
        return `${prefix}_${sequence}`;
      }
    },
    clock: {
      now() {
        return "2026-05-29T12:00:00.000Z";
      }
    },
    context: {
      async read(input) {
        return {
          subject: input.subject,
          actor: input.actor,
          productSurface: input.productSurface,
          metadata: input.metadata,
          corpus: [
            {
              id: "corpus_1",
              sourceType: "mock",
              title: "Mock entry",
              content: "Mock resolver context."
            }
          ]
        };
      }
    },
    draft: {
      async generate(input) {
        return {
          title: `${input.artifactType} draft`,
          body: `Draft for ${input.context.subject}`,
          metadata: {
            mocked: true
          }
        };
      }
    },
    feedback: {
      async capture(event) {
        return event;
      }
    },
    approval: {
      async request(request) {
        return request;
      },
      async resolve(request) {
        return request;
      }
    },
    publisher: {
      async publish(artifact) {
        return {
          publishedId: artifact.id
        };
      }
    },
    audit: {
      async log(event) {
        return event;
      }
    }
  };
}

test("rejects requests without the VIP API key", async () => {
  const handler = createHandler();
  const response = await handler(new Request("http://vip.local/api/health"));
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error.code, "unauthorized");
  assert.equal(typeof body.traceId, "string");
});

test("reads context over HTTP with trace metadata", async () => {
  const handler = createHandler();
  const response = await handler(
    jsonRequest("http://vip.local/api/read-context", {
      tenant_id: "tenant_1",
      traceId: "trace_read",
      subject: "member summary",
      productSurface: "test"
    })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.traceId, "trace_read");
  assert.equal(body.context.subject, "member summary");
  assert.equal(body.context.metadata.tenant_id, "tenant_1");
});

test("generates and stores a draft artifact only", async () => {
  const created: unknown[] = [];
  const handler = createHandler({
    artifactStore: {
      async createDraft(artifact) {
        created.push(artifact);
        return artifact;
      }
    }
  });

  const response = await handler(
    jsonRequest("http://vip.local/api/generate-draft", {
      tenant_id: "tenant_1",
      organization_id: "org_1",
      traceId: "trace_draft",
      subject: "forecast",
      artifactType: "financial-brief"
    })
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.traceId, "trace_draft");
  assert.equal(body.artifact.status, "draft");
  assert.equal(body.artifact.title, "financial-brief draft");
  assert.equal(created.length, 1);
});

test("captures feedback through the core approval guard", async () => {
  const handler = createHandler();
  const response = await handler(
    jsonRequest("http://vip.local/api/capture-feedback", {
      tenant_id: "tenant_1",
      traceId: "trace_feedback",
      body: "Turn this into learning.",
      createsLearningUpdate: true
    })
  );
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.traceId, "trace_feedback");
  assert.match(body.error.message, /Human approval is required/);
});

test("returns health metrics in the same shape as the health check", async () => {
  const handler = createHandler();
  const response = await handler(authorizedRequest("http://vip.local/api/health"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.health.databaseReachable, true);
  assert.equal(body.health.corpusCount, 3);
  assert.equal(body.health.pendingArtifactApprovals, 1);
});

function createHandler(overrides?: { artifactStore?: ArtifactStore; healthReader?: HealthReader }) {
  return createVIPHttpHandler({
    apiKey: "secret",
    createResolvers: createMockResolvers,
    artifactStore:
      overrides?.artifactStore ??
      ({
        async createDraft(artifact) {
          return artifact;
        }
      } satisfies ArtifactStore),
    healthReader:
      overrides?.healthReader ??
      ({
        async read() {
          return {
            databaseReachable: true,
            vipSchemaInstalled: true,
            healthViewReadable: true,
            corpusCount: 3,
            pendingArtifactApprovals: 1,
            pendingLearningCandidates: 2,
            latestAuditEventAt: null,
            latestLearningJobAt: null
          };
        }
      } satisfies HealthReader)
  });
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      authorization: "Bearer secret",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function authorizedRequest(url: string): Request {
  return new Request(url, {
    headers: {
      authorization: "Bearer secret"
    }
  });
}
