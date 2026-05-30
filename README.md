# Vilo Intelligence Platform

VIP is a provider-agnostic intelligence harness foundation for Vilo OS, ClinIQ, V_Aegis, Vitalis, and future products.

VIP is not Vilo OS. It does not include UI, product workflows, database clients, model providers, or publishing vendors. It defines reusable contracts and a small core orchestration layer that relies on injected resolvers for all external behavior.

## Packages

- `packages/vip-types`: shared types and resolver interfaces.
- `packages/vih-core`: provider-neutral harness functions.
- `packages/vip-memory`: formal memory layer for preferences, decisions, constraints, assumptions, conventions, and contextual memory.
- `packages/vip-packs/clinical`: clinical domain pack metadata and prompt guidance.
- `packages/vip-packs/financial`: financial domain pack metadata and prompt guidance.
- `packages/vip-packs/navigation`: navigation domain pack metadata and prompt guidance.

## Core Functions

- `readContext()`
- `generateDraft()`
- `captureFeedback()`
- `approveArtifact()`
- `publishArtifact()`
- `logAudit()`

All functions accept resolver dependencies. No core function imports Supabase, OpenAI, Anthropic, Vercel, or product-specific code.

## Memory

VIP memory is not corpus. It stores contextual facts that may inform generation, such as preferences, decisions, constraints, assumptions, conventions, relationship context, operational context, and compliance context.

Memory does not create procedural patterns and cannot override protocol, safety, compliance, or approved runtime data. All memory changes are auditable through append-only events.

## Safety Rules

- Human approval is required before publishing artifacts.
- Human approval is required before recording learning updates.
- Secrets must be supplied by callers or runtime infrastructure, never hardcoded.
- SQL files may be authored under `supabase/sql/`, but this repository does not assume Supabase exists and does not apply migrations.

## Development

```bash
npm install
npm test
```

Tests use mocked resolvers only.
