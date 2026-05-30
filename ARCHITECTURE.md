# VIP Architecture

VIP is a reusable intelligence harness, not a product application. Product surfaces such as Vilo OS, ClinIQ, V_Aegis, and Vitalis own their UI, auth, storage, vendor clients, deployment, and policy overlays.

## Boundaries

`vih-core` owns orchestration:

- loading context
- generating draft artifacts
- recording feedback
- requesting and recording approval
- publishing approved artifacts through an injected resolver
- writing audit events through an injected resolver

`vih-core` does not own:

- database connectivity
- model provider clients
- queueing
- product-specific schema
- UI
- secrets
- vendor SDKs

## Dependency Direction

```text
products
  -> vih-core
  -> vip-types

vip-packs
  -> vip-types

vip-memory
  -> vip-types
```

Products inject resolvers into `vih-core`. Resolvers may call databases, LLM providers, notification systems, or publishing targets, but those integrations live outside this core repository until explicitly added by a product.

## Approval Model

Drafts may be generated without approval. Publishing requires an approved artifact. Learning updates derived from feedback require a human approval event before they are persisted as reusable knowledge.

## Audit Model

Every meaningful state transition should call `logAudit()`. The core exposes the function, but the storage target is injected. This keeps audit storage portable across products and vendors.

## Memory Model

`packages/vip-memory` is separate from corpus. Corpus represents source material and reusable knowledge entries. Memory represents scoped contextual facts that can inform generation context.

Memory scopes are platform, product, tenant, study, user, relationship, and project. Memory categories include preference, decision, constraint, assumption, convention, relationship context, operational context, and compliance context.

Memory cannot override protocol, safety, compliance, or approved runtime data. Memory does not create procedural patterns. All creates, recalls, updates, and archives are auditable through injected event resolvers and the staged SQL `vip.memory_events` table.

## SQL Staging

SQL files under `supabase/sql/` are placeholders for future schema discussions. They are not applied by this repository and do not imply that Supabase is required.
