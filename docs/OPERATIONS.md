# Operations: deploys, migrations, backups, rollback, monitoring, incidents

SAAHI is one Vercel project (web app + one API function) and one Turso database. This is the runbook for keeping it safe to rely on.

## 1. Deploys

- Every push to `main` runs CI (`.github/workflows/ci.yml`): types, lint, API safety suites, migration upgrade test, backup/restore drill, Android and web bundles, browser tests at phone and laptop size. Don't merge on red.
- Vercel builds `main` to production. After each deploy, check:
  1. `GET /api/health` returns `{"ok":true,"schema":<latest>}`.
  2. The home page loads and the tracking page for an old link returns "ended" or "expired", not an error.
- Environment variables (Vercel → Settings → Environment Variables): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, **`JWT_SECRET`** (set a random 32+ byte value; without it the signing key is derived from the Turso token, so rotating that token signs everyone out), optional `ANTHROPIC_API_KEY`, `PUBLIC_SITE_URL` (custom domain), never `SAAHI_PUSH_MODE` in production.

## 2. Migrations

- Versioned in `server/db.ts` (`MIGRATIONS`), recorded in `schema_migrations`, run automatically on the first request of each cold start. Steps are idempotent and retried on lock contention, so two instances starting together are safe (tested).
- Rules for new migrations: additive only (new tables, nullable columns or columns with defaults, new indexes). Data rewrites must be idempotent. Never drop or rename a column in the same release that stops using it; do it two releases later.
- Test every migration with `npm run test:db` against a copy shaped like production.

## 3. Rollback

Use Vercel's "Instant Rollback" to the previous production deployment. Data compatibility:

| Roll back to | Safe? | Why |
| --- | --- | --- |
| Phase 2 build (`b3e3743`) from Phase 3–5 (`d4264ce` or later) | Yes | Schema v3 only added tables and nullable columns |
| Anything before Phase 2 (`77ac783` or earlier) | **No** | Schema v2 renamed delivery states (old screens crash on `device_compose`) and added the one-active-alert index (old code would fail to create a second alert with a 500). Roll forward with a fix instead. |

Database rollback is a restore (below), never a manual down-migration.

## 4. Backups and restore

- **Platform backups**: check what point-in-time restore the Turso plan provides and its retention; record it here once confirmed. (Human action.)
- **Logical backups**: `TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… npm run db:backup -- backups/saahi-YYYY-MM-DD.jsonl.gz`. Writes a gzipped file readable only by its owner (mode 600) containing every table, including vault files. Treat it as the most sensitive thing you hold: store it encrypted (e.g. `age` or a KMS-encrypted bucket), limit access to the incident rota, delete after 30 days.
- **Restore** (always into a new, empty database): create a new Turso database, then `TURSO_DATABASE_URL=<new> TURSO_AUTH_TOKEN=<new> npm run db:restore -- <file>`. It refuses a non-empty target, rebuilds indexes after loading, and verifies every table's row count against the backup footer. Then point a preview deployment at it, check `/api/health` and sign in with a test account, and only then switch production's environment variables.
- **Drill**: `tests/backup-drill.test.mjs` runs on every CI build. Also do a real drill against a copy of production once a quarter and record it below.

| Date | Who | Backup size | Restore time | Row counts matched | Notes |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## 5. Scheduled work

- The maintenance sweep (SafeWalk watchdog, push retries and receipts, 24 h silent-alert expiry, abandoned uploads, retention) runs during API traffic at most every 30 s per instance, on Vercel's daily cron, and on `GET /api/cron/watchdog` (throttled to once per 10 s globally).
- **Required for SafeWalk to be timely**: an external monitor calling `https://<domain>/api/cron/watchdog` every minute (UptimeRobot, cron-job.org, Better Stack). Without it, a missed check-in at 3 am with no other traffic waits for the daily cron. (Human action.)

## 6. Monitoring

Logs are one JSON object per line (`server/guard.ts` `log`). Set up a Vercel log drain or saved searches and alerts for:

| Event | Alert when | Meaning |
| --- | --- | --- |
| `api_error` | any on `alerts`, `public`, `auth` routes | Server fault on a safety path |
| `maintenance_failed` | any | Watchdog / retries not running |
| `migration_applied` | any outside a deploy | Unexpected schema change |
| `alert_dispatched` with `pushAccepted: 0` repeatedly | 3 in an hour | Push provider failing |
| `self_notice_failed` | spike | Push credentials or Expo problems |
| `audit_write_failed` | any | Audit trail gap |
| `area_hidden_pending_review` | any | Needs a moderator (below) |
| `sms_provider_unavailable` | any | Someone set `SMS_PROVIDER` without an implementation |

Also an uptime check on `/api/health` every minute, and the tracking page.

Never log: locations, message text, phone numbers, emails, file contents or tokens. Log ids only.

## 7. Moderation of area reports

When an area entry gets 3 flags it is hidden automatically. A reviewer checks the stored reports for that cell and category (`select category, time_band, area_label, created_at from reports where geohash6 = ? and category = ?`), never the reporters' identities, then either:
- restores it: `update area_moderation set status = 'visible', note = '<reason>', updated_at = <now> where geohash6 = ? and category = ?`
- or keeps it hidden and, if a label names a person, clears it: `update reports set area_label = null where geohash6 = ? and category = ? and area_label = ?`.

Target: reviewed within 3 working days. A proper reviewer screen is part of the campus/organisation tooling (`CAMPUS_DASHBOARD.md`).

## 8. Quarterly checks

- Re-check every number in `src/lib/support-directory.ts` against its source; update `DIRECTORY_CHECKED`.
- Run the device matrix (`DEVICE_TEST_MATRIX.md`) on at least A1, A2 and I2.
- Restore drill against a production copy.
- `npm audit` and dependency updates in a branch with full CI.

## 9. Incident response

Severity:
- **SEV1**: SOS, tracking links, cancel or push not working for anyone; or any exposure of locations, vault files, Pattern entries or contacts.
- **SEV2**: degraded (slow, intermittent, one platform), or SafeWalk watchdog not running.
- **SEV3**: anything else.

For SEV1:
1. Acknowledge within 15 minutes; one person leads, one writes the timeline.
2. If the app is giving false assurance (e.g. showing "Push sent" when pushes fail), put a banner up through a quick deploy and tell testers to rely on texts and 112.
3. Roll back if a deploy caused it (section 3), otherwise fix forward.
4. For data exposure: revoke the leaked credential (Turso token, `JWT_SECRET`; rotating `JWT_SECRET` signs everyone out, which is acceptable), preserve logs, and get legal advice the same day on notification duties. In India these include CERT-In's reporting directions for cyber incidents (6-hour window) and the Digital Personal Data Protection Act's breach notice to the Data Protection Board and affected people; confirm current timelines with counsel.
5. Write a blameless review within 5 working days: what happened, what users saw, what changed.

Contacts (fill in before launch): incident lead, backup lead, legal counsel, Turso support, Vercel support, Expo support.
