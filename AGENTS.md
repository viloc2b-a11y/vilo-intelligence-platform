# Agent Guidelines

## Mission

Build VIP as a provider-agnostic intelligence harness. Keep it reusable across Vilo OS, ClinIQ, V_Aegis, Vitalis, and future products.

## Non-Negotiables

- VIP is not Vilo OS.
- Do not add UI.
- Do not connect to vendors yet.
- Do not hardcode secrets.
- `packages/vih-core` must not import Supabase, OpenAI, Anthropic, Vercel, or product-specific code.
- All external behavior must use injected resolvers.
- Human approval is required before publishing artifacts.
- Human approval is required before publishing learning updates.
- Memory is not corpus and must stay separate from `corpus_entries`.
- Memory may inform generation context, but cannot override protocol, safety, compliance, or approved runtime data.
- All memory changes must be auditable.
- Tests must use mocked resolvers only.

## Working Pattern

1. Add or update shared contracts in `packages/vip-types`.
2. Keep orchestration in `packages/vih-core`.
3. Keep formal memory behavior in `packages/vip-memory`.
4. Put domain defaults in `packages/vip-packs/*`.
5. Put future SQL drafts in `supabase/sql/` without applying them.
6. Add tests under `__tests__/` using only in-memory resolver mocks.
