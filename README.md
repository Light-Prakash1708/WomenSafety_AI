# SAAHI

**A safety network that remembers the pattern, signals quietly and shows you help is coming.**

Created by Prakash.

SAAHI is a women's safety app for India that runs on Android, iOS and the web (any computer or phone browser, installable like an app). It's built with Expo (React Native), a single Vercel function for the API, and a Turso (libSQL) database. Most safety apps cover the ten seconds after someone presses SOS. SAAHI also covers the weeks before (escalating harassment and stalking) and the days after (evidence and support).

> SAAHI works alongside 112 India. It does not replace emergency services, cannot guarantee that anyone reaches a person in time, and must be tested on real phones before anyone relies on it.

---

## What it does

| Feature | What happens |
| --- | --- |
| **Hold-to-SOS** | Hold the red button for 2 seconds (or shake the phone hard 3 times while the app is open). Location is fixed, an alert opens, and everyone in her circle gets a text with a live-location link. Contacts who also have SAAHI get a push notification. |
| **Delivery receipts** | The SOS screen shows each person's real status: Queued, Sent, Opened link, **On it**. If there's no internet, the text carries a Google Maps link instead, and the screen says "Offline" rather than pretending. |
| **Duress PIN** | Two PINs. The cancel PIN ends the alert. The duress PIN makes her screen say "cancelled" while location keeps streaming, and helpers see *"She may have been forced to cancel"*. Long-press the `saahi.` logo on Home to see the real alert again. |
| **Live tracking page** | A small web page (`/track`) opened from the SOS text. No app or account needed. Shows her location on a map, lets the helper pick their name and tap "I'm on it", which appears on her phone within seconds. |
| **Escalation Graph (Pattern)** | Log messages, calls, new accounts, sightings, threats and the moment she blocked someone. A 21-day chart, a timeline, counts like "3 events after blocking", and an AI-drafted summary she can edit. Shareable as text for an ICC or police complaint. |
| **Walk with me** | Check-ins every 2 to 15 minutes. Miss one, get a 30-second grace, then SOS starts. A server watchdog also catches missed check-ins when the phone dies or the app is killed (see *Watchdog timing* below). |
| **Evidence Vault** | Screenshots, photos, written accounts and audio recorded during SOS (up to 25 MB each). Every file gets a SHA-256 fingerprint on the device, and the server re-checks it before saving. Export a case pack listing each item with its time and fingerprint. Every view and export is logged. |
| **Support** | Start from "It just happened", "A while ago" or "It's ongoing". Tap-to-call helplines (112, 181, 14490, 1930, 15100, 14416, 1098), plus an AI guide that answers in English, Hindi or Bengali with general information only. |
| **Community safety layer** | Report an unsafe spot (poor lighting, harassment, unsafe stop). Reports are pooled into roughly 1 km cells and only shown once 3 different women report the same thing. Places, never people. |
| **Guardian mode** | Each contact gets an 8-character guardian code. She sends it (WhatsApp or the share sheet); when that person enters it in SAAHI, they get push alerts and an in-app view with her location and an "I'm on it" button. A code works once and can be replaced, so nobody can become her guardian by guessing a phone number. |
| **Quick exit** | One tap turns SAAHI into a working calculator. Long-press **AC** to return. |
| **Ghost call** | A believable incoming call after 5 seconds, to leave an uncomfortable situation. |
| **Accounts** | Email and password. At sign-up she gets a one-time recovery code, the only way to reset a forgotten password, which also signs out every other device. 10 wrong attempts lock sign-in for 15 minutes. |
| **Languages** | English, हिंदी, বাংলা for core screens and SOS text messages. |

### AI boundaries (by design)

The AI organises what she chooses to add and explains options in plain language. It never labels anyone a criminal, never judges whether an assault happened, never scans faces, and never predicts who will commit a crime. AI summaries are always labelled as summaries, never as evidence. Without an `ANTHROPIC_API_KEY`, the app still works: summaries fall back to counted rules and the guide to curated text.

---

## Project layout

```
api/index.ts            The Vercel function: every /api route goes here
server/
  app.ts                Routes: accounts, circle, SOS, tracking, journeys + watchdog, pattern, vault, areas, guide
  db.ts                 Turso connection and schema (tables are created on first request)
  security.ts           Password hashing (scrypt), session tokens, recovery and guardian codes
  ai.ts, push.ts        AI summaries and guide (optional), Expo push notifications
src/
  app/                  Screens (Expo Router)
    (tabs)/             Home, Pattern, Walk, Vault, Support
    sos.tsx             Active SOS screen
    sign-in.tsx         Sign in, create account, reset with recovery code
    join.tsx            Guardian enters an invite code
    calculator.tsx      Quick-exit disguise
    ghost-call.tsx      Fake incoming call
    entry.tsx           Log a pattern entry
    guardian/[id].tsx   A guardian's view of someone's alert
    onboarding.tsx, contacts.tsx, settings.tsx, report-area.tsx
  components/           UI kit, SOS hold button, PIN pad, chart, icons
  lib/
    api.ts              API client and shared types
    sos.tsx             SOS engine (location, SMS, push, polling, recording, duress)
    vault.ts            Fingerprinting, chunked upload and download, case pack
    layout.ts           Phone vs laptop layout (side rail from 900 px)
    pwa.ts              Makes the web build installable
    bg-location.ts, pins.ts, app-state.tsx, i18n.ts, theme.ts, geo.ts, prefs.ts, notifications.ts, pattern.ts
public/                 Web app shell: page template, install manifest, icons, offline cache
web/track/              SOS tracking page for contacts
scripts/                Build step for the tracking page; local server (npm run dev)
vercel.json             Build, routing, function settings and the daily watchdog cron
```

---

## Web app

The same codebase runs in the browser with the same design. On phones it uses the bottom tab bar; on laptops and tablets (900 px and wider) navigation moves to a left rail with an always-available SOS button, and content sits in a centred column.

**Run it on your computer** (the app and the API together, no accounts needed):

```bash
npm install
npm run build:web           # builds the site into dist/
npm run dev                 # http://localhost:3000
```

With no `.env`, it uses a local database file (`saahi-local.db`). To use your Turso database instead, copy `.env.example` to `.env` and fill in `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.

**Install it like an app.** Open the site in Chrome or Edge and choose *Install SAAHI* in the address bar (on a phone: *Add to Home Screen*). It opens in its own window with the SAAHI icon, and the app shell still opens on a weak connection.

**It's live on Vercel.** Every push to `main` redeploys <https://womensafety-ai.vercel.app>: the app, `/track` for contacts, and `/api`.

**What's different in a browser.** Browsers can't send texts, run in the background or read the motion sensor, so:

| On a phone (app) | In a browser |
| --- | --- |
| SOS opens your Messages app with the alert prefilled | SOS shows a WhatsApp and a Text button for each person, plus *Copy alert message* |
| Location keeps sharing with the screen locked | Keep the SAAHI tab open to keep sharing |
| Shake 3 times to send SOS | Hold the SOS button with mouse, finger or space bar |
| Push alerts for guardians | Guardians see alerts on Home when they open SAAHI |
| PINs in the phone's secure storage | PINs stored as hashes in the browser's local storage |

Quick exit also renames the browser tab to "Calculator".

## Setup

### 1. Deploy on Vercel with Turso

1. Import the GitHub repo into Vercel. The project name must be lowercase (for example `womensafety-ai`). Leave the framework as **Other**: `vercel.json` sets the build command, output folder and routing.
2. Add the **Turso** integration from the Vercel Marketplace and connect it to the project. It adds `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`; that's all SAAHI needs. Tables are created automatically on the first request.
3. Optional environment variables:
   - `ANTHROPIC_API_KEY`: AI-written pattern summaries and the multilingual guide. Without it, SAAHI uses built-in summaries and curated answers.
   - `JWT_SECRET`: a long random string for signing sessions. **Set this for any real use.** If unset, one is derived from your Turso token, so rotating that token signs everyone out.
4. Deploy. Check `https://<your-project>.vercel.app/api/health` returns `{"ok":true}`.

#### Watchdog timing

Vercel's free (Hobby) plan runs cron jobs once a day, so the built-in cron is only a backstop. SAAHI also checks for missed journeys during normal use: any SAAHI request, including a guardian's home screen or a tracking page refreshing every 10 seconds, can trigger the check. For minute-level checks even when nobody has SAAHI open, point a free scheduler such as cron-job.org at `https://<your-project>.vercel.app/api/cron/watchdog` every minute. It only acts on journeys that are already overdue, so it's safe to leave public.

### 2. Phone app

The phone app talks to `https://womensafety-ai.vercel.app` by default. To point it elsewhere, set `EXPO_PUBLIC_API_URL` in `.env`.

### 3. Push notifications (for guardians)

```bash
npx eas-cli@latest login
npx eas-cli@latest init        # creates the project and prints a projectId
```

Put the projectId in `.env` as `EXPO_PUBLIC_EAS_PROJECT_ID`. For Android push, add FCM credentials with `npx eas-cli@latest credentials` (see Expo's push notification setup guide).

### 4. Run it on a phone

SAAHI uses native modules (background location, audio, notifications), so it needs a development build rather than Expo Go:

```bash
npx eas-cli@latest build --profile development --platform android
# install the APK on your phone, then:
npx expo start --dev-client
```

Or with Android Studio installed: `npm run android`.

### 5. Build for testers and the stores

```bash
npm run build:android          # installable APK for testers
npx eas-cli@latest build --profile production --platform android   # Play Store bundle
npx eas-cli@latest build --profile production --platform ios       # App Store (needs Apple developer account)
npx eas-cli@latest submit
```

---

## Repository

Code: <https://github.com/Light-Prakash1708/WomenSafety_AI>. `.env` is git-ignored. Never commit your Turso token; on Vercel it lives in the project's environment variables.

---

## How the pieces talk

```
 Her phone or browser                       Vercel (/api → Turso)                 Helpers
 ────────────────────                       ─────────────────────                 ───────
 Hold SOS ─► POST /api/alerts ───────────►  alert + one row per contact
                                            Expo push ─────────────────────────►  Guardians with the app
          ─► SMS / WhatsApp from her device ─────────────────────────────────►    Everyone in her circle
          ─► location every ~10 s ───────►  alert_locations
                                            /api/public/alert ◄── every 10 s ──   Tracking page (/track)
 SOS screen ◄── polls every 5 s ─────────   alert_recipients ◄── "I'm on it" ──   Helper taps a button
 Walk with me ─► check-ins ──────────────►  watchdog (cron + traffic) ────────►   alert + push if missed
```

Privacy rules on the server:
- Every query is scoped to the signed-in account; another account's ID in a URL returns "not found".
- Helpers without the app reach an alert only through `/api/public/alert`, using a 36-character random token in the link. Once she cancels with the real PIN, location stops being returned.
- Guardians see only *active* alerts, and only from someone whose invite code they entered.
- Area reports come back only as aggregated counts, and only once 3 different people report the same thing.
- Passwords are stored as scrypt hashes, recovery codes as hashes, PINs never leave the device.

---

## Tested

Every push runs the full suite in GitHub Actions. Details and what each test proves: [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md).

- **API (229 checks)**: `tests/api.test.mjs` (core flows), `tests/safety.test.mjs` (duplicate and concurrent SOS, cancel before create, duress, truthful delivery states, stale locations, link expiry and rotation, cross-account access, forged and expired tokens, rate limits, push retries, watchdog, vault validation and quota, audit trail) and `tests/records.test.mjs` (entry corrections with history, summary staleness, community report privacy and moderation).
- **Database**: upgrade from the original schema under two concurrent instances (`tests/migration.test.ts`) and a backup → restore drill (`tests/backup-drill.test.mjs`).
- **Browser**: the whole journey in Chromium at phone and laptop size, including cancelling from a second device with a password, with an edge-overflow check on every screen.

Not verified yet, because it needs real phones and credentials: push delivery, SMS from the phone, background location when locked, shake to SOS. See [`docs/DEVICE_TEST_MATRIX.md`](docs/DEVICE_TEST_MATRIX.md).

## Documentation

| Doc | What it covers |
| --- | --- |
| [`docs/AUDIT.md`](docs/AUDIT.md) | Baseline audit, implementation matrix, what Phase 2 fixed |
| [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) | Verified vs untested, blockers, actions needing approval |
| [`docs/NOTIFICATIONS.md`](docs/NOTIFICATIONS.md) | Delivery states, push retries, India DLT steps for server SMS |
| [`docs/VAULT_ENCRYPTION.md`](docs/VAULT_ENCRYPTION.md) | Encryption design for review (not deployed) |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Deploys, migrations, backups, rollback, monitoring, incidents |
| [`docs/DEVICE_TEST_MATRIX.md`](docs/DEVICE_TEST_MATRIX.md) | Real-device cases to run before relying on it |
| [`docs/CAMPUS_DASHBOARD.md`](docs/CAMPUS_DASHBOARD.md) | Institution dashboard design (not built) |

## Known limits in v0.1

Be upfront about these with testers:

- **SMS needs a tap.** iOS and Android don't let apps send texts silently, so the Messages app opens prefilled and she must tap Send. Push to guardians is instant. Server-sent SMS needs DLT registration and a gateway; see `docs/NOTIFICATIONS.md`. Delivery labels only claim what the phone or a provider confirmed.
- **Shake to SOS works only while SAAHI is open.** A lock-screen trigger, volume-button trigger or voice safe word needs custom native code and real-device testing.
- **Background location depends on permissions.** On Android she must choose "Allow all the time". Some phone brands (Xiaomi, Oppo, Vivo) kill background apps aggressively; test on them.
- **The watchdog can only push.** If her phone dies during a journey, contacts *with the app* are alerted; others need an SMS provider.
- **Vault files are private but not end-to-end encrypted.** They're stored in your Turso database and only reachable through her signed-in account. Client-side encryption is designed in `docs/VAULT_ENCRYPTION.md` and needs an independent review before it ships.
- **Password reset needs the recovery code.** There's no email reset yet, because that needs an email provider (such as Resend). If she loses both her password and her code, the account can't be recovered.
- **Legal review.** Before a real launch in India, get advice on the DPDP Act 2023, evidence handling, mandatory reporting and child protection.

## Roadmap

1. Campus dashboard for security desks and ICCs (the first paying customer).
2. Verified responder network with training and audit trails.
3. Bluetooth panic button pairing.
4. End-to-end encrypted vault (after review of the design).
5. Automatic SMS through an Indian provider.

## Development

```bash
npm run typecheck                    # app and server
npx eslint src
npm run test:api                     # API suites against a local libSQL database
npm run test:db                      # migration upgrade + backup/restore drill
npm run build:web && npm run test:e2e   # browser tests (needs Python Playwright)
npm run build:web && npm run dev     # full app + API on http://localhost:3000
npm run db:backup -- out.jsonl.gz    # logical backup (see docs/OPERATIONS.md)
```

CI runs all of these on every push.

## License

MIT. See [LICENSE](LICENSE). Created by Prakash.
