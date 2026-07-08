# Noriba Quality Auto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic movement-count quality labels from historical Mac mini image/weather data and show normal/reference labels in the noriba trend UI.

**Architecture:** `taxi-ic-helper` computes 15-minute `quality` metadata from weather codes, image QC metrics, and day/night image mode, then writes it into `advance-forecast.json`. The daily report UI reads optional `quality` and falls back to time-based rules for older JSON.

**Tech Stack:** Node ESM, JSONL, static HTML/JS, node:test.

---

### Task 1: Helper Quality Metadata

**Files:**
- Modify: `/Users/hideakimacbookair/repos/taxi-ic-helper/scripts/lib/advance-forecast.mjs`
- Modify: `/Users/hideakimacbookair/repos/taxi-ic-helper/scripts/publish-advance-forecast.mjs`
- Test: `/Users/hideakimacbookair/repos/taxi-ic-helper/tests/advance-forecast.test.mjs`

- [ ] Add failing tests for `isRainWeatherCode()` and `buildQualityByBucket()`.
- [ ] Implement `isRainWeatherCode()`, image QC weakness detection, and 96-bucket quality aggregation.
- [ ] Load `taxi-pool-history.jsonl` and full `slot-occupancy-history.jsonl` in `publish-advance-forecast.mjs`.
- [ ] Add `quality` to `slots[]` and `actualsToday[]`.
- [ ] Run `node --test tests/advance-forecast.test.mjs`.

### Task 2: Daily Report UI

**Files:**
- Modify: `tools/js/noriba-trends.js`
- Modify: `tools/noriba-trends.html`
- Modify: `tests/noriba-trends.test.js`
- Modify: `sw.js`

- [ ] Add failing tests for quality-driven confidence override.
- [ ] Make `toTrendBins()` preserve `quality`.
- [ ] Make `movementConfidenceForTime()` accept optional `quality` and prefer it over fallback time rules.
- [ ] Make daypart table compute normal/reference/mixed from row quality.
- [ ] Keep existing labels compact: `通常`, `参考`, `一部参考`.
- [ ] Run `node tests/noriba-trends.test.js`, `node tests/sw-precache-imports.test.js`, syntax checks, and HTML parser.

### Task 3: Independent Verification

**Files:**
- Read-only verification across both repos.

- [ ] Verify helper tests pass.
- [ ] Verify daily report tests pass.
- [ ] Confirm generated JSON remains backward-compatible when `quality` is missing.
