# SAAHI audit and baseline

Audited commit: `275fb53` (main, deployed to https://womensafety-ai.vercel.app). Date: 22 Oct 2026.
Method: every file under `api/`, `server/`, `src/`, `web/`, `public/`, `scripts/` and the config files was read. Every existing check was run before any code changed. Findings marked **verified** were confirmed by reading the code path end to end or by a failing reproduction, not inferred from the UI.

## 1. Stack as found

| Layer | What's there | Files |
| --- | --- | --- |
| App | Expo SDK 57, React Native 0.86, Expo Router; Android, iOS and web (PWA) from one codebase | `src/`, `app.json`, `app.config.js` |
| API | One Vercel Node function, 20 route groups, Web `fetch` handler | `api/index.ts`, `server/app.ts` |
| Database | Turso (libSQL) over HTTPS; tables created with `CREATE TABLE IF NOT EXISTS` on first request | `server/db.ts` |
| Auth | Email + password (scrypt N=16384), HS256 session tokens (60 days), recovery code (16 chars), lockout after 10 failures per email in 15 min | `server/security.ts`, `server/app.ts` |
| Push | Expo push service, fire-and-forget | `server/push.ts` |
| SMS | None on the server. The phone opens its own Messages app prefilled; the browser opens WhatsApp / SMS links | `src/lib/sos.tsx`, `src/app/sos.tsx` |
| Hosting | Vercel (Hobby). `vercel.json`: build, rewrites, daily cron | `vercel.json` |
| CI | GitHub Actions: typecheck, lint, Android bundle | `.github/workflows/ci.yml` |

## 2. Baseline results (before any change)

| Check | Result |
| --- | --- |
| `npm run typecheck` (app + server) | Pass |
| `npx eslint src` | Pass, 0 warnings |
| Web build (`npm run build:web`) | Pass |
| Android / iOS JS bundles (`expo export`) | Pass |
| API suite (91 checks, local libSQL) | 91 pass |
| Browser suite, phone 390×844 | 56 pass |
| Browser suite, laptop 1440×900 | 58 pass |
| `npm audit --omit=dev` | 24 advisories (18 high, 6 moderate). None are in the API's dependency tree (`@libsql/client`); all are in Expo / Metro build tooling, `node-forge` via `@expo/code-signing-certificates`, `query-string` via `expo-router`, and `react-native` internals. Expo SDK upgrades are the remediation path. |
| `expo-doctor` | 19/21; the 2 failures are network checks that couldn't reach `exp.host` from the audit sandbox, not project problems |
| Live deployment | `/api/health` returns `{"ok":true}` against Turso; app, `/track`, deep links and manifest load |

**Process gaps found in the baseline:**
- **The test suites aren't in the repo.** The API and browser suites live outside it (`/opt/lab2`), so CI runs neither, and a regression would ship green.
- **The schema can't evolve safely.** There's no versioned migration system; `CREATE TABLE IF NOT EXISTS` can't add a column to the live database.
- **There's no audit trail** for safety-critical events (who cancelled, who joined as guardian, who opened evidence).
- **There's no backup or restore procedure** for the Turso database.

## 3. Implementation matrix

Status key: **Working**, verified end to end. **Partial**, works but with a gap below. **Unsafe**, the gap can hurt a user in an emergency or leak data. **Missing**, not built. **Platform**, depends on device behaviour that can't be verified without real hardware.

Severity: **P0**, can cause a failed or false emergency response, or exposure of a survivor's location or evidence. **P1**, security or privacy weakness with a plausible abuse path. **P2**, correctness, robustness or operability.

| # | Feature | Implementation | Status | Sev | Finding (verified) | Change | Regression test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | SOS create | `POST /alerts`; `src/lib/sos.tsx` `start()` | **Unsafe** | P0 | No idempotency. The client times out at 8 s; if the server already created the alert, the 20 s retry loop creates a second alert with duplicate recipients and pushes. | Client-generated `client_ref`; server returns the existing alert for the same ref; at most one active alert per account | Repeated SOS with same ref returns one alert; a second SOS while one is active returns that one |
| 2 | SOS cancel race | `submitPin()` vs in-flight `createServerAlert()` | **Unsafe** | P0 | Cancelling while the first request is in flight is lost: `start()` resumes after its awaits, re-arms the alert, sends SMS, starts tracking and recording. The server alert stays live with nobody watching. Duress during that window is also never sent, so helpers aren't warned. | Generation token; a pending cancel/duress is applied to the server alert as soon as it exists, by `client_ref`, even if creation finishes later | Cancel by ref before/after create; duress queued before create is applied |
| 3 | Cancel PIN on a new device | `pins.ts` `checkPin`, onboarding | **Unsafe** | P0 | PINs live only on the device that ran onboarding. Signing in on another phone or a browser skips onboarding (`onboarded = true`), so `checkPin` returns "wrong" for every PIN and the SOS can never be cancelled. `hasPins()` exists but is never called. | Require PIN setup on any device without PINs before Home; on the SOS screen, allow cancelling with the account password when no PINs exist | Browser: fresh sign-in on a second "device" lands on PIN setup |
| 4 | Recipient status truth | `sms-sent`, push | **Unsafe** | P0 | Android's composer returns "unknown", yet the app marks every recipient "sent". An Expo push ticket "ok" is shown as "Sent" though it only means Expo accepted it. | Separate states: `queued`, `device_compose` (opened in her Messages app), `device_sent` (iOS confirmed), `provider_accepted`, `provider_delivered`, `failed`, `link_opened`, `acknowledged`; status can only move forward | State machine table tests; Android "unknown" never becomes "sent" |
| 5 | Location freshness | `alerts/:id/locations`, `getFix()` | **Unsafe** | P0 | If GPS is slow the app falls back to a location up to 10 min old, and the server stamps it as "now". Helpers see a stale position as current. No range validation on lat/lng. | Send the fix's own timestamp; server stores it (clamped to now), rejects out-of-range or >24 h old fixes; tracking page and guardian view show "last updated X ago" and a stale warning after 2 min | Stale fix keeps old timestamp; invalid coordinates rejected |
| 6 | Location permission denied | `sos.tsx` screen | Partial | P1 | Screen shows "Searching" forever when permission is denied or GPS fails. | Explicit "Location is off" state with a button to settings and a note that texts say "location unavailable" | UI check with geolocation permission denied |
| 7 | Tracking link lifetime | `public/alert` | **Unsafe** | P1 | Links never expire. After an alert ends, the link still returns her first name and recipients' statuses indefinitely. An alert left active (phone lost) shares location forever. | Ended alerts: link returns only "ended" for 7 days, then 410. Owner can rotate the link (old token dies at once). Active alerts with no location or heartbeat for 24 h expire. | Rotate kills old token; expired link 410; stale active alert expires in sweep |
| 8 | Guardian invites | `guardian/join`, `contacts/:id/new-code` | Partial | P1 | Codes never expire; no rate limit on join attempts (brute force); slight modulo bias in code generation; the owner can't see who joined. | Rejection-sampled codes; 7-day expiry; 10 failed joins per hour per account; owner sees the guardian's name and can revoke | Expired code refused; 11th wrong attempt locked; revoke removes access at once |
| 9 | Auth | `auth/*`, `currentUser` | Partial | P1 | No IP-level rate limit on sign-up, login or recovery (an attacker can spray many emails); no "sign out everywhere"; user-not-found returns faster than a wrong password (timing). | IP + email rate limits; `POST /auth/logout-all`; dummy-hash verification for unknown emails | IP limit triggers; logout-all revokes old tokens |
| 10 | SafeWalk watchdog | `sweepJourneys` | Partial | P1 | Never retries a push that failed; opens a second alert if one is already active; the public cron endpoint can be hammered. | Reuse the active alert; bounded push retries (max 3, 60 s apart); global 10 s throttle on the public endpoint | Watchdog with existing alert reuses it; retry counter stops at 3 |
| 11 | Evidence vault | `vault/*` | Partial | P1 | Abandoned uploads leave parts forever; parts of incomplete items can be downloaded; no per-account storage quota. | Sweep deletes incomplete uploads after 24 h; download only completed items; 500 MB quota | Incomplete item not downloadable; quota exceeded refused |
| 12 | Audit trail | none | **Missing** | P1 | No record of cancel/duress/ack/guardian join/revoke/evidence view. | `audit_log` table written by the API; owner can read her own | Events recorded for each action |
| 13 | Schema migrations | `server/db.ts` | **Missing** | P1 | Can't add columns to the live Turso database. | Versioned, idempotent migrations with a `schema_migrations` table; safe under concurrent cold starts | Fresh DB and a v1-shaped DB both migrate to latest |
| 14 | Backups | none | **Missing** | P1 | No documented backup or restore. | `scripts/backup.ts` (export) and `scripts/restore.ts` (import into a new database) plus a restore drill in tests | Backup → restore into empty DB → row counts and hashes match |
| 15 | SMS from the server | none | **Missing** (by design) | P0 for launch | Only her own phone sends texts, after she taps Send. | Provider abstraction; real provider only with credentials and DLT approval (Phase 3) | Provider contract tests with a fake provider |
| 16 | Live tracking page | `web/track` | Working | P2 | Works; doesn't show location age. | Add "updated X ago" + stale banner | Covered by 5 |
| 17 | Duress PIN | `submitPin`, `alerts/:id/duress` | Partial | P0 | Works once an alert exists on the server; lost in the race in #2. | Covered by #2 | Covered by #2 |
| 18 | Guardian view | `guardian/[id].tsx`, `alerts/:id` | Working | P2 | Works; no stale indicator. | Covered by #5 | Covered by #5 |
| 19 | Escalation Graph | `threads/*`, `pattern.tsx`, `entry.tsx` | Partial | P2 | Entries can't be edited or corrected; summaries don't say what they were based on or when they became out of date. | Phase 5: edit with revision history, source reference, summary basis + staleness | Edit keeps prior revision; summary marked stale after edit |
| 20 | Community reports | `reports`, `areas` | Partial | P1 | Free-text place names are shown to everyone (could name a person or a home); the same person can report the same spot repeatedly (counted once, but stored); no way to flag or correct; 180-day window. | Phase 5: never show free text publicly; one report per person per spot per 30 days; flags hide a notice pending review; 90-day expiry; delete own reports | Free text not in public response; duplicate updates instead of inserting |
| 21 | Support + AI guide | `support.tsx`, `server/ai.ts` | Partial | P2 | Helpline numbers are hard-coded without sources; AI answers aren't labelled as AI or as uncertain in the UI. | Phase 4: source-verified directory with "checked on" dates; AI disclosure line | Directory entries all have a source URL and date |
| 22 | Vault encryption | none | **Missing** | P1 | Files are protected by access control and Turso's at-rest encryption, not end-to-end. | Phase 4: design document only (no unreviewed crypto shipped) | n/a |
| 23 | Campus dashboard | none | **Missing** | P2 | Not built. | Phase 6: design + data model; build after an institution and operational owner are confirmed | n/a |
| 24 | Background location | `bg-location.ts` | Platform | P0 | Code paths exist; behaviour on locked/killed apps depends on OS and vendor. | Phase 7 device matrix | Real devices only |
| 25 | Push delivery | `notifications.ts`, `push.ts` | Platform | P0 | Requires EAS project ID + FCM/APNs credentials; never verified on a device. | Phase 3 receipts; Phase 7 device test | Real devices only |
| 26 | Shake to SOS | `sos.tsx` | Platform | P2 | Only while the app is in the foreground. | Document | Real devices only |
| 27 | Quick exit / ghost call | `calculator.tsx`, `ghost-call.tsx` | Working | P2 | Browser suite covers both. | none | existing |
| 28 | Account deletion | `DELETE /me` | Working | P2 | Removes all rows and vault parts. Will need to include new tables. | Extend to new tables | existing + new tables |

## 4. Order of work

Dependencies decide the order. Migrations (#13) come first because most fixes add columns. Then the P0 SOS fixes (#1–5, #17), then the remaining P1s (#3 UI, #6–12, #14), then Phase 3 (#15), then Phases 4–5 (#19–22). The campus dashboard (#23) and device verification (#24–26) are documented with what they need from people, because they can't be completed from code alone.

## 5. Phase 2 result (P0/P1 hardening)

The matrix above is the baseline as found. After Phase 2:

| # | Now | Evidence |
| --- | --- | --- |
| 1 | Fixed. `client_ref` on every SOS; partial unique indexes `alerts_one_active`, `alerts_client_ref` | `safety.test.mjs`: same-ref retry, second SOS, 6 concurrent presses → one alert; e2e retried request |
| 2 | Fixed. Generation counter stops a cancelled `start()`; cancel goes through a persistent outbox; `alerts/by-ref/:ref/cancel` wins even before the create (tombstone) | cancel-before-create, 8 concurrent create/cancel races |
| 3 | Fixed. Devices without PINs ask for the account password (`auth/verify-password`, 10 tries / 15 min); `GET alerts/active` lets a new device find and end a running alert | e2e "new device" flow; API lockout test |
| 4 | Fixed. Recipient states `queued, failed, device_compose, device_sent, provider_accepted, provider_delivered, link_opened, acknowledged`, forward-only | device-sms results, receipt → delivered, no downgrade after ack (mutation-checked) |
| 5 | Fixed. `fix_at` stored, last location only moves forward, invalid / 0,0 / >24 h fixes rejected; stale flag after 120 s on track page, guardian view, her screen | 4 freshness tests |
| 6 | Fixed. "Location is off" state on her SOS screen | manual / e2e screenshot |
| 7 | Fixed. Ended alert hides name, location and recipients; 410 after 7 days; `rotate-link`; silent alerts expire after 24 h | tracking-link and expiry tests |
| 8 | Fixed. 7-day invite expiry, join lockout (10/user, 30/IP per hour), rejection-sampled codes, owner sees who joined, "Revoke app access" | invite tests |
| 9 | Fixed. IP limits on sign-up/login/recovery, sign out everywhere, constant-time unknown-email path, 200-char password cap | forged/expired/alg:none/typ/tv tokens, limits |
| 10 | Fixed. Watchdog reuses the active alert; push retries capped at 3, permanent failures not retried; cron endpoint throttled | watchdog and retry tests |
| 11 | Fixed. Quota 500 MB, exact part sizes, base64 check, no download before finish, abandoned uploads swept after 24 h | vault tests |
| 12 | Fixed. `audit_log` (no locations or message text), readable by the owner in Settings → Activity | audit tests |
| 13 | Fixed. Versioned migrations with retry on lock contention | `migration.test.ts` (v1 database with legacy rows, two concurrent instances) |
| 14 | Fixed. `npm run db:backup` / `db:restore` (refuses non-empty target, detects truncation) | `backup-drill.test.mjs` |
| 15, 24–26 | Unchanged: need credentials and real devices (Phases 3 and 7) | — |

One bug was found by the new tests and fixed: a wrong password on the cancel-by-password screen returned 401, which the client treats as "session ended" and signed her out mid-emergency. It now returns 403.
