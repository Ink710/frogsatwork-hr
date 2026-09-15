# ADR-003 — Accept Neon cold starts; never run an uptime pinger

**Status:** accepted, **learned the hard way** · **Date:** 2026-08 · **Applies to:** all deployed apps

> This is the most expensive lesson in the repo. An uptime pinger **took all three demos offline.**

## Context

Neon's free tier autosuspends compute after ~5 minutes idle. The first request after idle pays a
cold-start delay of a few seconds. This is visible in a demo and looks like slowness.

## Options

1. **Ping the database every few minutes** to keep it warm.
2. **Accept the cold start.**
3. Pay for a tier without autosuspend.

## Decision

**Option 2. Leave autosuspend alone.** Mention the delay in the Loom if it is noticeable.

## Why option 1 is actively harmful — the arithmetic

Neon free allows **100 CU-hrs/month**. Compute runs at **0.25 CU**, so the budget is roughly
**400 hours of *active* compute**.

A ping every ~5 minutes means the database **never suspends**: ~720 hours of activity per month,
≈ **180 CU-hrs** — quota exhausted well before month end. Every app on that database then has
connections **refused**.

**Cold starts and quota are the same dial.** Bursty demo traffic on the default 5-minute autosuspend
uses a few compute-hours a month. Prefer the cold start.

## ⚠️ Diagnosing it again

The failure reads like an outage rather than a limit, because Vercel stays up and only DB-backed
routes fail. The signature:

| Symptom | Reading |
|---|---|
| `/login` returns **200** (no DB) while `/api/health` returns **503** | the app is fine, the database is not |
| DB-backed pages **500** | same |
| failure is **sub-second** | rules out a cold wake (seconds, then succeeds) **and** a network timeout (much longer) |

Then check the Neon **usage** figures — and make sure you are looking at the right Neon **org and
project**. An unrelated project's tidy dashboard will happily tell you nothing is wrong.

## Implications for the product build

A paid tier changes the arithmetic and this ADR with it. Until then, **no monitoring that polls the
database on a timer** — including uptime checks a hosting provider offers by default. Health checks
must hit a route that does not touch Postgres.
