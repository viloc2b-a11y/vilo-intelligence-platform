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
- Tests must use mocked resolvers only.

## Working Pattern

1. Add or update shared contracts in `packages/vip-types`.
2. Keep orchestration in `packages/vih-core`.
3. Put domain defaults in `packages/vip-packs/*`.
4. Put future SQL drafts in `supabase/sql/` without applying them.
5. Add tests under `__tests__/` using only in-memory resolver mocks.
