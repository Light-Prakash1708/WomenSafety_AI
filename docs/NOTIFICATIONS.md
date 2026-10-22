# Notifications: what SAAHI sends, what it can prove, and what launch needs

This document is the contract for every "sent", "delivered" or "seen" that SAAHI shows. Code: `server/notify.ts`, `server/guard.ts` (`advanceRecipient`), `src/lib/api.ts` (`RECIPIENT_LABELS`), `web/track/index.html`.

## 1. Channels today

| Channel | Who sends | Needs | Status |
| --- | --- | --- | --- |
| SMS from her own phone | Her phone's Messages app, prefilled by SAAHI. She presses Send. | Nothing from SAAHI. Person-to-person SMS is not commercial traffic, so DLT does not apply. | Built. iOS reports sent / cancelled; Android reports nothing. Web shows one WhatsApp/Text button per person. |
| Push to guardians with the app | Expo push service → FCM (Android) / APNs (iOS) | EAS project ID in `app.json`, FCM server key and APNs key uploaded to EAS | Code built and tested against a fake provider. **Never verified on a real device.** |
| SMS from the server | An Indian SMS gateway | DLT registration, sender ID, approved templates, whitelisted URL, gateway account | **Not built.** Interface only (`SmsProvider`). Needs credentials and approval, see §4. |
| Phone call / IVR | — | Provider, DLT voice registration | Not planned for v1. |

## 2. Recipient states

Every person on an alert has one state. It only moves forward (`advanceRecipient`); a failed push can be retried and move on. Nothing except `acknowledged` means a human has seen the alert.

| State | Means exactly | Set by | Shown to her | Shown on the link |
| --- | --- | --- | --- | --- |
| `queued` | Nothing has gone to this person yet | Alert creation | Waiting | Not sent yet |
| `failed` | A provider refused it or reported failure. `attempts` and `error` record why. | Push send or receipt | Not delivered | Not delivered |
| `device_compose` | Her phone opened its Messages app with the text. Whether she pressed Send is unknown (Android). | `POST alerts/:id/device-sms {result:"unknown"}` | Text opened | Text opened on her phone |
| `device_sent` | iOS reported she pressed Send. Delivery to the handset is not confirmed. | `device-sms {result:"sent"}` | Text sent | Texted from her phone |
| `provider_accepted` | Expo (or a future SMS gateway) accepted it. Not yet delivered. | Push ticket `ok` | Push queued | App alert queued |
| `provider_delivered` | Push: Expo's receipt says it was handed to Apple/Google. SMS (future): handset delivery report. Still not "seen". | Receipt poll in maintenance | Push sent | App alert sent |
| `link_opened` | Someone opened her tracking link and chose this name. It may not be that person. | Tracking page | Opened link | Opened link |
| `acknowledged` | A person pressed "I'm on it" (in the app, or on the link under this name). | Guardian app or link | On it | On it |

`device-sms {result:"cancelled"}` changes nothing: she backed out, so the person stays `queued`.

Migration v2 converted old rows honestly: the old `sent` for SMS became `device_compose` (the old code set it for Android's "unknown"), for push it became `provider_accepted`, and `opened` became `link_opened`.

## 3. Push delivery, retries and receipts

- `dispatchAlert` sends one push per linked guardian with a push token, only when the alert is first created (a reused alert never re-notifies).
- Retryable failures (network, HTTP 429/5xx, provider errors other than `DeviceNotRegistered`) are retried by the maintenance sweep no sooner than 60 s apart, at most **3 attempts**, for alerts started in the last hour and still active.
- Permanent failures (`DeviceNotRegistered`, not an Expo token) are recorded and not retried.
- Receipts are polled for `provider_accepted` rows older than 15 s (and younger than 24 h); an `ok` receipt moves the row to `provider_delivered`, an error moves it to `failed` with the reason.
- The maintenance sweep runs on every API instance at most every 30 s while there is traffic, on `/api/cron/watchdog` (throttled to once per 10 s globally), and on the daily Vercel cron. **For minute-level SafeWalk checks and push retries with no traffic, an external pinger must call `/api/cron/watchdog` every minute** (Vercel Hobby crons run once a day). That is a human action, listed in `PRODUCTION_READINESS.md`.
- Tests: `SAAHI_PUSH_MODE=fake` (tokens containing `fail` are retryable failures, `dead` are permanent) and `SAAHI_PUSH_MODE=disabled`. Production leaves it unset, which uses Expo.

## 4. Adding server SMS in India (needs credentials and approval)

SAAHI must not send SMS from the server until all of this is done and a person has approved it. Every item needs the operating entity's documents; none can be done by code.

1. **Principal Entity registration on a DLT platform** (any operator's: Jio, Airtel, Vi, BSNL). Needs the legal entity's documents. TRAI's TCCCPR 2018 framework requires it for any business SMS.
2. **Header (sender ID)**: a 6-character alphabetic header, e.g. `SAAHIS`, registered under the right category. SOS alerts are service messages triggered by the user's own action; confirm the category with the gateway (service-implicit is the usual fit, not promotional).
3. **Content templates**, registered and approved, with variables only where the template allows. Draft:
   - `{#var#} has sent an SOS from SAAHI. Live location: {#url#} . If you can't reach her, call 112. -SAAHI`
   - `{#var#} is safe now. Thank you. -SAAHI`
   - `{#var#} missed a SafeWalk check-in. Last location: {#url#} . Call her, then 112 if needed. -SAAHI`
4. **URL whitelisting**: since 1 October 2024 operators block commercial SMS containing URLs that are not whitelisted for the entity. The tracking link domain (the production domain, not `*.vercel.app` if a custom domain is used) must be whitelisted. Tracking links contain a per-alert token; confirm with the gateway how a variable path or query on a whitelisted domain is handled before relying on it.
5. **Gateway account** with delivery reports (DLR) by webhook, an idempotency key per message, and an India data-processing agreement.
6. **Consent and opt-out**: the people she adds have not consented to SAAHI. The first message to each should say who added them and how to stop (reply STOP or a link). The current invite text already explains this; the template needs it too.
7. **Cost and abuse**: per-account limits already exist (30 alerts per hour). Add a per-recipient daily cap before enabling.

Implementation once approved (small, reviewable): implement `SmsProvider.send` for the chosen gateway in `server/notify.ts`; in `dispatchAlert`, send to contacts without push; set `provider_accepted` on gateway 2xx and store its message id in `provider_ref`; add a DLR webhook route that moves rows to `provider_delivered` / `failed`; retries as for push. Credentials go in Vercel environment variables (`SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_TEMPLATE_*`), never in the repo. Until then, `SMS_PROVIDER` set to anything logs `sms_provider_unavailable` and sends nothing.

## 5. Push credentials (needs a human)

- `eas init` to create the EAS project and put its `projectId` in `app.json` → `extra.eas.projectId`.
- Android: a Firebase project, `google-services.json`, and the FCM v1 service-account key uploaded with `eas credentials`.
- iOS: an Apple Developer account and an APNs key uploaded with `eas credentials`; Critical Alerts entitlement would need Apple's approval and is not requested.
- Then run the device matrix in `DEVICE_TEST_MATRIX.md` (push sections) before claiming push works.

Sources: [TRAI URL whitelisting directive, MediaNama, Sept 2024](https://www.medianama.com/2024/09/223-trai-whitelisting-directive-3000-entities-approve-urls/); [BusinessWorld on whitelisting uptake](https://businessworld.in/article/over-275-lakh-urls-whitelisted-by-10000-entities-after-trai-guidance-536499). Checked 22 October 2026; confirm current rules with the chosen gateway before registering.
