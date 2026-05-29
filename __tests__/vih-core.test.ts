import assert from "node:assert/strict";
import test from "node:test";
import {
  approveArtifact,
  captureFeedback,
  generateDraft,
  publishArtifact,
  readContext
} from "@vilo/vih-core";
import type { Artifact, VIPResolvers } from "@vilo/vip-types";

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
              title: "Mock corpus",
              content: "Only mocked resolver data is used."
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
          publishedId: `published_${artifact.id}`,
          location: "mock://published"
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

test("reads context through an injected resolver", async () => {
  const resolvers = createMockResolvers();
  const context = await readContext(
    {
      subject: "member risk summary",
      productSurface: "test"
    },
    { resolvers }
  );

  assert.equal(context.id, "ctx_1");
  assert.equal(context.subject, "member risk summary");
  assert.equal(context.corpus[0]?.sourceType, "mock");
});

test("generates drafts without provider imports", async () => {
  const resolvers = createMockResolvers();
  const context = await readContext({ subject: "forecast" }, { resolvers });
  const artifact = await generateDraft(
    {
      context,
      artifactType: "financial-brief"
    },
    { resolvers }
  );

  assert.equal(artifact.status, "draft");
  assert.equal(artifact.title, "financial-brief draft");
  assert.equal(artifact.contextId, context.id);
});

test("blocks learning updates without human approval", async () => {
  const resolvers = createMockResolvers();

  await assert.rejects(
    captureFeedback(
      {
        body: "Save this as reusable guidance.",
        createsLearningUpdate: true
      },
      { resolvers }
    ),
    /Human approval is required/
  );
});

test("blocks publishing until an artifact is approved", async () => {
  const resolvers = createMockResolvers();
  const artifact: Artifact = {
    id: "art_1",
    contextId: "ctx_1",
    type: "brief",
    title: "Draft",
    body: "Body",
    status: "draft",
    createdAt: "2026-05-29T12:00:00.000Z",
    updatedAt: "2026-05-29T12:00:00.000Z"
  };

  await assert.rejects(publishArtifact(artifact, { resolvers }), /Human approval is required/);
});

test("publishes after approval", async () => {
  const resolvers = createMockResolvers();
  const artifact: Artifact = {
    id: "art_1",
    contextId: "ctx_1",
    type: "brief",
    title: "Draft",
    body: "Body",
    status: "draft",
    createdAt: "2026-05-29T12:00:00.000Z",
    updatedAt: "2026-05-29T12:00:00.000Z"
  };

  const { artifact: approved } = await approveArtifact(
    {
      artifact,
      reason: "Human approved."
    },
    { resolvers }
  );
  const published = await publishArtifact(approved, { resolvers });

  assert.equal(approved.status, "approved");
  assert.equal(published.status, "published");
});
