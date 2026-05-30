import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveMemory,
  recall,
  remember,
  updateMemory,
  type MemoryEntry,
  type MemoryResolvers
} from "@vilo/vip-memory";

function createMockResolvers(): MemoryResolvers & {
  entries: Map<string, MemoryEntry>;
  auditEvents: unknown[];
} {
  let sequence = 0;
  const entries = new Map<string, MemoryEntry>();
  const auditEvents: unknown[] = [];

  return {
    entries,
    auditEvents,
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
    memory: {
      async create(entry) {
        entries.set(entry.id, entry);
        return entry;
      },
      async recall(input) {
        const values = [...entries.values()].filter((entry) => {
          if (entry.status !== "active") {
            return false;
          }
          if (!input.includePlatform && entry.tenantId === null) {
            return false;
          }
          if (input.tenantId && entry.tenantId !== null && entry.tenantId !== input.tenantId) {
            return false;
          }
          if (input.scopes && !input.scopes.includes(entry.scope)) {
            return false;
          }
          if (input.categories && !input.categories.includes(entry.category)) {
            return false;
          }
          if (input.query && !entry.content.toLowerCase().includes(input.query.toLowerCase())) {
            return false;
          }
          return true;
        });

        return values.slice(0, input.limit ?? values.length);
      },
      async update(entry) {
        entries.set(entry.id, entry);
        return entry;
      },
      async getById(id) {
        return entries.get(id) ?? null;
      }
    },
    events: {
      async append(event) {
        auditEvents.push(event);
        return event;
      }
    }
  };
}

test("remembers active memory without creating corpus", async () => {
  const resolvers = createMockResolvers();

  const entry = await remember(
    {
      scope: "tenant",
      category: "preference",
      tenantId: "tenant_1",
      content: "Prefer concise operational summaries.",
      confidence: 0.8,
      sourceType: "human"
    },
    { resolvers }
  );

  assert.equal(entry.status, "active");
  assert.equal(entry.scope, "tenant");
  assert.equal(entry.metadata?.memoryRules instanceof Object, true);
  assert.equal(resolvers.auditEvents.length, 1);
});

test("recalls platform and tenant memory with mocked resolvers", async () => {
  const resolvers = createMockResolvers();

  await remember(
    {
      scope: "platform",
      category: "constraint",
      content: "Memory cannot override protocol or safety data.",
      sourceType: "human"
    },
    { resolvers }
  );
  await remember(
    {
      scope: "tenant",
      category: "convention",
      tenantId: "tenant_1",
      content: "Use sponsor-approved terminology.",
      sourceType: "human"
    },
    { resolvers }
  );

  const results = await recall(
    {
      tenantId: "tenant_1",
      query: "protocol"
    },
    { resolvers }
  );

  assert.equal(results.length, 1);
  assert.equal(results[0]?.scope, "platform");
  assert.equal(resolvers.auditEvents.length, 3);
});

test("updates active memory and appends an audit event", async () => {
  const resolvers = createMockResolvers();
  const entry = await remember(
    {
      scope: "project",
      category: "decision",
      content: "Use the draft approval path.",
      sourceType: "human"
    },
    { resolvers }
  );

  const updated = await updateMemory(
    {
      id: entry.id,
      content: "Use the human approval path before publishing."
    },
    { resolvers }
  );

  assert.match(updated.content, /human approval/);
  assert.equal(resolvers.auditEvents.length, 2);
});

test("archives memory instead of deleting it", async () => {
  const resolvers = createMockResolvers();
  const entry = await remember(
    {
      scope: "relationship",
      category: "relationship_context",
      content: "Reviewer prefers escalation notes grouped by study.",
      sourceType: "human"
    },
    { resolvers }
  );

  const archived = await archiveMemory(
    {
      id: entry.id,
      reason: "No longer applicable."
    },
    { resolvers }
  );

  assert.equal(archived.status, "archived");
  assert.equal(resolvers.auditEvents.length, 2);
});

test("rejects invalid memory confidence", async () => {
  const resolvers = createMockResolvers();

  await assert.rejects(
    remember(
      {
        scope: "user",
        category: "assumption",
        content: "Assumption requiring confirmation.",
        confidence: 2,
        sourceType: "human"
      },
      { resolvers }
    ),
    /confidence/
  );
});
