# ADR-002 — Reviewers may mutate the demo data

**Status:** accepted · **Date:** 2026-08 · **Applies to:** the deployed demos

## Context

Demo reviewers sign in as HR and have genuine write access. Nothing stops them editing, terminating
or hiring seeded people. Over time the data drifts from the curated state the walkthrough assumes.

## Options

1. **Read-only demo mode** — a flag that refuses writes. Guts the demo: the effective-dated history
   and the approval flows *are* the product.
2. **Scheduled reseed** — Vercel Cron hitting a protected reseed route, or a nightly `db:seed`.
3. **Accept drift.**

## Decision

**Option 3, for now.** Accept drift. Option 2 is the fallback if it becomes messy — **deferred, not
built**.

## Consequences

- A reviewer may encounter data that does not match the walkthrough.
- Nothing is at risk: the data is synthetic and the database is isolated per project.
- A reseed is always available manually (`pnpm --filter @hris/database db:seed`), and Julian runs
  any reset or reseed himself.

## Implications for the product build

This decision **does not survive contact with a paying tenant**. Real tenants own their data; there
is no reseed, and "accept drift" becomes "accept data loss". A product build needs per-tenant
provisioning of a *starting* dataset, not a shared mutable one — and that provisioning does not
exist yet (see [ADR-005](005-two-role-database-split.md) on manual role creation).
