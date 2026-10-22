# Production readiness report

Date: 22 October 2026. Scope: the SAAHI repository at `main` after Phases 1–7 of the production-readiness work. Baseline and findings: `AUDIT.md`.

**Verdict: not ready for public launch as an emergency tool.** The server and web app are hardened and tested, but the parts that most decide whether help arrives (push to guardians, background location on locked phones, server SMS) have not been verified on real devices or are not enabled. It is suitable for a **closed pilot** with informed testers who are told to treat it as an addition to 112 and phone calls, once the blockers in section 3 marked "pilot" are done.

## 1. Verified (automated, runs in CI on every push)

| Area | What is proven | Test |
| --- | --- | --- |
| SOS creation | Idempotent by `client_ref`; one active alert per person even under 6 simultaneous presses; retries never duplicate recipients or pushes | `safety.test.mjs`, e2e |
| Cancel and duress | Cancel by reference wins even before the create arrives; 8 create/cancel races all end cancelled; duress keeps the alert live and warns helpers | `safety.test.mjs`, e2e |
| Cancel on a new device | Running alert is found; no PIN on the device → password; wrong password keeps alert and session; lockout after 10 | e2e, `safety.test.mjs` |
| Delivery truth | Eight forward-only states; nothing claims delivery or reading without a provider receipt or a person's acknowledgement (checked by a deliberate code mutation) | `safety.test.mjs` |
| Push retries | Bounded at 3 attempts; permanent failures not retried; receipts move to "Push sent" | `safety.test.mjs` (fake provider) |
| Location | Fix time kept; late older fixes don't overwrite; invalid, 0,0 and >24 h fixes rejected; stale after 2 min shown on her screen, the link and the guardian app | `safety.test.mjs`, e2e |
| Tracking links | Ended alerts reveal nothing; 410 after 7 days; rotation kills the old link; silent alerts expire after 24 h | `safety.test.mjs` |
| Access control | Other accounts and guardians can't read, cancel, rotate, acknowledge, download or delete what isn't theirs; revoked guardians lose access at once | `safety.test.mjs`, `records.test.mjs` |
| Auth | Forged, expired, wrong-type, `alg:none`, deleted-user and signed-out-everywhere tokens refused; IP and per-account limits; no timing tell for unknown emails | `safety.test.mjs`, `api.test.mjs` |
| Guardian invites | 7-day expiry, uniform random codes, join lockout | `safety.test.mjs` |
| Evidence vault | Exact part sizes, base64 check, no partial downloads, SHA-256 verified, 500 MB quota, abandoned uploads swept | `safety.test.mjs`, e2e |
| Audit trail | Records safety actions without locations or message text; owner-only | `safety.test.mjs` |
| Escalation Graph | Corrections keep earlier versions and reasons; summaries state their basis and say when they're out of date | `records.test.mjs`, e2e |
| Community reports | Dedupe, 90-day window, 180-day deletion, place names only with 3 agreeing reporters, flag-to-hide, delete own | `records.test.mjs`, e2e |
| Schema and data | Upgrade from the original schema with legacy rows under two concurrent instances; backup → restore with identical evidence bytes; refuses unsafe restores | `migration.test.ts`, `backup-drill.test.mjs` |
| Web app | Full user journey at phone and laptop size, no element past the screen edge | `tests/e2e/ui_test.py` |
| Account deletion | Removes rows in every table, including the new ones | all suites |

Last local run: API 91 + safety 108 + records 30, migration 14, restore drill 16, browser 72 (phone) and 74 (laptop): all passing. Types and lint clean. CI status for each commit is on GitHub.

## 2. Built but untested (needs real devices or credentials)

| Item | Why untested | How to verify |
| --- | --- | --- |
| Push notifications to guardians | Needs EAS project, FCM and APNs credentials | `NOTIFICATIONS.md` §5, then device cases 10–11 |
| Background location when locked or swiped away | OS and vendor dependent | Device cases 5–7 |
| SMS from her phone (iOS/Android results) | Native only | Device cases 12–13 |
| Shake to SOS | Native sensors | Device case 14 |
| Audio recording during SOS on phones | Tested in desktop Chromium only | Device case 16 |
| Outbox cancel after app restart with no signal | Logic tested in browser; persistence on phones untested | Device case 3 |
| AI guide and summaries with a live model | No `ANTHROPIC_API_KEY` in tests; fallback text tested | Set the key in a preview and review 20 sample answers in all three languages |
| Real Expo push receipts | Fake provider in tests | Device case 10 |

## 3. Blockers

| Blocker | Needed for | Owner |
| --- | --- | --- |
| Set `JWT_SECRET` in Vercel | Pilot | Project owner |
| Minute pinger on `/api/cron/watchdog` | Pilot (SafeWalk timing, push retries) | Project owner |
| EAS project + FCM + APNs credentials, then device cases 1–16 on A1, A2, I2 at least | Pilot | Project owner + testers |
| Uptime and log alerts (`OPERATIONS.md` §6) | Pilot | Project owner |
| Confirm Turso backup/PITR on the plan; first real restore drill | Pilot | Project owner |
| Privacy notice and terms that match what the app actually does (incl. AI processing by Anthropic, data locations, retention) | Pilot | Legal review |
| Server SMS (DLT entity, header, templates, URL whitelisting, gateway) | Public launch | Operating entity, `NOTIFICATIONS.md` §4 |
| Vault end-to-end encryption, after independent review | Public launch (or remove any "secure vault" wording until then) | Security reviewer, `VAULT_ENCRYPTION.md` |
| Full device matrix incl. Vivo/Oppo/Realme and accessibility | Public launch | Testers |
| DPDP Act compliance review, grievance officer, breach process | Public launch | Legal |
| Store listings honest about limits (works alongside 112, not instead) | Public launch | Project owner |
| Moderation reviewer and turnaround | Public launch (community reports) | Operations |

## 4. External actions requiring human approval

None of these were done, and none were simulated as done:

1. Creating accounts or credentials with Expo/EAS, Firebase, Apple, an SMS gateway, a DLT platform or an uptime service.
2. Registering a DLT entity, sender ID or templates, or whitelisting URLs.
3. Setting production secrets in Vercel (`JWT_SECRET`, `ANTHROPIC_API_KEY`, `PUBLIC_SITE_URL`).
4. Running backups or restores against the production database.
5. Engaging a security reviewer for vault encryption and a lawyer for privacy, DPDP and DLT matters.
6. Any campus partnership (`CAMPUS_DASHBOARD.md` is a design only).

## 5. Deliberately not built

Facial recognition, public accusations or naming of individuals, offender risk scores, automated judgements about whether a crime occurred, and any claim that an alert was delivered or seen without a recorded provider receipt or a person's acknowledgement.

## 6. Rollback

Roll back within Phase 2+ builds freely; never below Phase 2 (`OPERATIONS.md` §3).
