# SAAHI

**A safety network that remembers the pattern, signals quietly and shows you help is coming.**

Created by Prakash.

SAAHI is an Android and iOS app for women's safety in India, built with Expo (React Native) and Supabase. Most safety apps cover the ten seconds after someone presses SOS. SAAHI also covers the weeks before (escalating harassment and stalking) and the days after (evidence and support).

> SAAHI works alongside 112 India. It does not replace emergency services, cannot guarantee that anyone reaches a person in time, and must be tested on real phones before anyone relies on it.

---

## What it does

| Feature | What happens |
| --- | --- |
| **Hold-to-SOS** | Hold the red button for 2 seconds (or shake the phone hard 3 times while the app is open). Location is fixed, an alert opens, and everyone in her circle gets a text with a live-location link. Contacts who also have SAAHI get a push notification. |
| **Delivery receipts** | The SOS screen shows each person's real status: Queued, Sent, Opened link, **On it**. If there's no internet, the text carries a Google Maps link instead, and the screen says "Offline" rather than pretending. |
| **Duress PIN** | Two PINs. The cancel PIN ends the alert. The duress PIN makes her screen say "cancelled" while location keeps streaming, and helpers see *"She may have been forced to cancel"*. Long-press the `saahi.` logo on Home to see the real alert again. |
| **Live tracking page** | A small web page (`web/track`) opened from the SOS text. No app or account needed. Shows her location on a map, lets the helper pick their name and tap "I'm on it", which appears instantly on her phone. |
| **Escalation Graph (Pattern)** | Log messages, calls, new accounts, sightings, threats and the moment she blocked someone. A 21-day chart, a timeline, counts like "3 events after blocking", and an AI-drafted summary she can edit. Shareable as text for an ICC or police complaint. |
| **Walk with me** | Check-ins every 2 to 15 minutes. Miss one, get a 30-second grace, then SOS starts. A server watchdog also catches missed check-ins when the phone dies or the app is killed. |
| **Evidence Vault** | Screenshots, photos, written accounts and audio recorded during SOS. Every file gets a SHA-256 fingerprint on the phone at save time. Export a case pack listing each item with its time and fingerprint. Every view and export is logged. |
| **Support** | Start from "It just happened", "A while ago" or "It's ongoing". Tap-to-call helplines (112, 181, 14490, 1930, 15100, 14416, 1098), plus an AI guide that answers in English, Hindi or Bengali with general information only. |
| **Community safety layer** | Report an unsafe spot (poor lighting, harassment, unsafe stop). Reports are pooled into roughly 1 km cells and only shown once 3 different women report the same thing. Places, never people. |
| **Guardian mode** | If a contact signs up with the same phone number, they're linked automatically. They get push alerts and an in-app view with her location and an "I'm on it" button. |
| **Quick exit** | One tap turns SAAHI into a working calculator. Long-press **AC** to return. |
| **Ghost call** | A believable incoming call after 5 seconds, to leave an uncomfortable situation. |
| **Languages** | English, हिंदी, বাংলা for core screens and SOS text messages. |

### AI boundaries (by design)

The AI organises what she chooses to add and explains options in plain language. It never labels anyone a criminal, never judges whether an assault happened, never scans faces, and never predicts who will commit a crime. AI summaries are always labelled as summaries, never as evidence. Without an `ANTHROPIC_API_KEY`, the app still works: summaries fall back to counted rules and the guide to curated text.

---

## Project layout

```
src/
  app/                  Screens (Expo Router)
    (tabs)/             Home, Pattern, Walk, Vault, Support
    sos.tsx             Active SOS screen
    calculator.tsx      Quick-exit disguise
    ghost-call.tsx      Fake incoming call
    entry.tsx           Log a pattern entry
    guardian/[id].tsx   A guardian's view of someone's alert
    onboarding.tsx, sign-in.tsx, contacts.tsx, settings.tsx, report-area.tsx
  components/           UI kit, SOS hold button, PIN pad, chart, icons
  lib/
    sos.tsx             SOS engine (location, SMS, push, realtime, recording, duress)
    bg-location.ts      Background location task
    vault.ts            Fingerprinting, upload, case pack
    pins.ts             Cancel and duress PINs (hashed, on-device only)
    supabase.ts, app-state.tsx, i18n.ts, theme.ts, geo.ts, prefs.ts, notifications.ts, pattern.ts
supabase/
  migrations/           Database schema + row-level security + storage bucket
  functions/            alert-public, sos-dispatch, ai, journey-watchdog
  cron.sql              Schedules the watchdog every minute
web/
  index.html            Landing page
  track/                SOS tracking page for contacts (GitHub Pages ready)
```

---

## Setup

You need: Node 20+, a free [Supabase](https://supabase.com) account, a free [Expo](https://expo.dev) account, and an Android phone (or iPhone) for testing.

### 1. Install

```bash
npm install
cp .env.example .env
```

### 2. Create the backend (Supabase)

1. Create a new Supabase project (region: Mumbai `ap-south-1` is closest for India).
2. Install the CLI and link it:
   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   ```
3. Create the database tables, security rules and vault bucket:
   ```bash
   npx supabase db push
   ```
4. Deploy the functions:
   ```bash
   npx supabase functions deploy alert-public --no-verify-jwt
   npx supabase functions deploy journey-watchdog --no-verify-jwt
   npx supabase functions deploy sos-dispatch
   npx supabase functions deploy ai
   ```
5. Set secrets (the tracking page URL is from step 4 below):
   ```bash
   npx supabase secrets set TRACK_PAGE_URL=https://YOURNAME.github.io/saahi/track
   npx supabase secrets set CRON_SECRET=$(openssl rand -hex 24)
   # Optional, for AI summaries and the multilingual guide:
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   ```
6. Schedule the Walk with me watchdog: open `supabase/cron.sql`, fill in your project ref and the same `CRON_SECRET`, and run it in the Supabase SQL editor.
7. Make sign-in emails send a 6-digit code: in **Authentication → Email Templates → Magic Link**, include `{{ .Token }}` in the body, for example: `Your SAAHI code is {{ .Token }}`.
8. Copy **Project URL** and the **anon / publishable key** from **Project Settings → API** into `.env`.

### 3. Push notifications (for guardians)

```bash
npx eas-cli@latest login
npx eas-cli@latest init        # creates the project and prints a projectId
```

Put the projectId in `.env` as `EXPO_PUBLIC_EAS_PROJECT_ID`. For Android push, add FCM credentials with `npx eas-cli@latest credentials` (see Expo's push notification setup guide).

### 4. The tracking page (GitHub Pages)

1. Edit `web/track/config.js` with the same Supabase URL and anon key. The anon key is designed to be public.
2. Push the repo to GitHub, then go to **Settings → Pages → Source: GitHub Actions**. The included workflow publishes `web/` on every push to `main`.
3. Your page is at `https://YOURNAME.github.io/REPO-NAME/track`. Put that in `.env` (`EXPO_PUBLIC_TRACK_PAGE_URL`) and in the `TRACK_PAGE_URL` secret.

### 5. Run it on a phone

SAAHI uses native modules (background location, audio, notifications), so it needs a development build rather than Expo Go:

```bash
npx eas-cli@latest build --profile development --platform android
# install the APK on your phone, then:
npx expo start --dev-client
```

Or with Android Studio installed: `npm run android`.

### 6. Build for testers and the stores

```bash
npm run build:android          # installable APK for testers
npx eas-cli@latest build --profile production --platform android   # Play Store bundle
npx eas-cli@latest build --profile production --platform ios       # App Store (needs Apple developer account)
npx eas-cli@latest submit
```

---

## Push to GitHub

```bash
git add -A
git commit -m "SAAHI v0.1"
git branch -M main
git remote add origin https://github.com/YOURNAME/saahi.git
git push -u origin main
```

`.env` is git-ignored. Never commit your service-role key; the app only ever uses the anon key.

---

## How the pieces talk

```
 Her phone (SAAHI app)                         Supabase                         Helpers
 ─────────────────────                         ────────                         ───────
 Hold SOS ─► insert alert + recipients ─────►  alerts, alert_recipients
          ─► sos-dispatch ─────────────────►   Expo push ──────────────────►   Guardians with the app
          ─► SMS from her own phone ──────────────────────────────────────►   Everyone in her circle
          ─► location every ~10 s ─────────►   alert_locations
                                               alert-public ◄── GET/POST ───   Tracking page (web/track)
 SOS screen ◄── realtime "On it" ───────────   alert_recipients ◄─ "On it" ─   Helper taps a button
 Walk with me ─► next_checkin_at ──────────►   journey-watchdog (cron, 1 min) ─► alert + push if missed
```

Privacy rules in the database:
- Every table has row-level security: she sees only her own rows.
- Helpers without the app reach an alert only through `alert-public`, using a 36-character random token in the link. Once she cancels (with the real PIN), location stops being returned.
- Guardians with the app can see only *active* alerts from people who listed their number.
- Community reports are returned only through `area_safety()`, which aggregates and hides any category with fewer than 3 distinct reporters.
- PINs never leave the phone.

---

## Tested

v0.1 was tested end to end against a local Supabase-compatible stack (Postgres 16, Supabase Auth, PostgREST, the four edge functions) with the web build driven in Chromium at phone size:

- **63 backend checks passed**: email-code sign-in, row-level security between users, guardian auto-linking and access, the public tracking link (open, "On it", bad and unknown tokens), duress, real cancel hiding location, AI summary and guide fallbacks, the 3-reporter threshold for area reports, the Walk with me watchdog (no double alerts), and vault upload, access and signed links.
- **42 in-app checks passed**: sign-in, onboarding validation, language switching, short tap not firing SOS, hold-to-SOS with GPS, the helper's tracking page, live "2 people are coming", wrong PIN, duress PIN, revealing the hidden alert, real cancel, pattern entries and summary, journeys and check-ins, vault fingerprints matching the saved text, SOS audio saved to the vault, area reports, the calculator disguise, ghost call, and deleting all data.

Not covered by those runs, so test on real phones: SMS sending, push delivery, background location with the screen locked, shake to SOS, and realtime updates (the app also polls every 8 seconds as a fallback).

## Known limits in v0.1

Be upfront about these with testers:

- **SMS needs a tap.** iOS and Android don't let apps send texts silently, so the Messages app opens prefilled and she must tap Send. Push to guardians is instant. For fully automatic SMS, add a provider like MSG91 or Twilio (with DLT registration in India) in `supabase/functions/_shared/util.ts`.
- **Shake to SOS works only while SAAHI is open.** A lock-screen trigger, volume-button trigger or voice safe word needs custom native code and real-device testing.
- **Background location depends on permissions.** On Android she must choose "Allow all the time". Some phone brands (Xiaomi, Oppo, Vivo) kill background apps aggressively; test on them.
- **The watchdog can only push.** If her phone dies during a journey, contacts *with the app* are alerted; others need an SMS provider.
- **Vault files are private but not end-to-end encrypted.** They're protected by Supabase storage policies and encryption at rest. Client-side encryption is on the roadmap.
- **Legal review.** Before a real launch in India, get advice on the DPDP Act 2023, evidence handling, mandatory reporting and child protection.

## Roadmap

1. Campus dashboard for security desks and ICCs (the first paying customer).
2. Verified responder network with training and audit trails.
3. Bluetooth panic button pairing.
4. End-to-end encrypted vault.
5. Automatic SMS through an Indian provider.

## Development

```bash
npm run typecheck
npx eslint src
npx expo export --platform android   # checks the bundle builds
```

CI runs all three on every push.

## License

MIT. See [LICENSE](LICENSE). Created by Prakash.
