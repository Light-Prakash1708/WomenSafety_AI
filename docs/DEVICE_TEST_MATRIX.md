# Device test matrix

Automated tests cover the server and the web build in Chromium (phone and laptop sizes). These behaviours depend on the phone's operating system, maker and settings, so they can only be verified on real devices. **None of the rows below has been run yet.** Record each run in the table at the end; a row counts as verified only with a dated result.

Use synthetic accounts and contacts only (team members' own phones as "guardians"). Never test with real emergency numbers: replace 112 with a team phone in a test build, or stop at the dialer screen.

## Devices

Minimum set, chosen for India's market and for aggressive battery management:

| Id | Device | OS | Why |
| --- | --- | --- | --- |
| A1 | Low-end Android (2–3 GB RAM), e.g. Redmi A-series | Android 13–14, MIUI/HyperOS | Most common class; MIUI kills background apps |
| A2 | Mid-range Samsung (A-series) | Android 14–15, One UI | Large share; "Sleeping apps" |
| A3 | Pixel or Android One | Android 15–16 | Stock behaviour baseline |
| A4 | Vivo / Oppo / Realme | Android 14, Funtouch / ColorOS | Strict background limits |
| I1 | Older iPhone (SE 2nd gen or 11) | iOS 17 | Oldest supported |
| I2 | Recent iPhone | iOS 18+ / current | Current behaviour |
| W1 | Chrome on Android, Safari on iPhone, Chrome/Edge on laptop | Current | Web app |

## Cases

| # | Case | Steps | Pass when |
| --- | --- | --- | --- |
| 1 | Hold SOS, good signal | Hold 2 s | Alert on server within 5 s; guardian push arrives; tracking link shows location under 30 s old |
| 2 | SOS with no data | Airplane mode with SMS on (or data off) | Messages opens with a maps link; alert appears on server within 40 s of data returning, **once** |
| 3 | Cancel while offline | Start SOS offline, cancel with PIN, then restore data | No active alert remains on server within 30 s of data returning; guardians' links say ended |
| 4 | Duress PIN | Enter duress PIN | Screen says cancelled; alert stays active; link and guardian app show the forced-cancel warning |
| 5 | Locked screen, 15 min | Start SOS, lock phone, walk 500 m | Track page updates at least every 2 min; no "old location" warning unless signal was lost |
| 6 | App swiped away | Start SOS, swipe app from recents | Note behaviour per device. Android with background permission should keep sharing (foreground service notification visible); iOS will stop. Reopening the app finds the alert. |
| 7 | Battery saver on | Repeat 5 with battery saver | Record interval; warning shown on track page if stale |
| 8 | Location denied | Deny location, hold SOS | Screen says location is off; texts still open; no endless "Searching" |
| 9 | New device | Sign in on a second phone without PINs, open the running alert, cancel with password | Alert ends; wrong password doesn't sign her out |
| 10 | Push to killed guardian app | Guardian's app swiped away / phone locked | Notification arrives with sound; tapping opens the alert; status reaches "Push sent" |
| 11 | Push permission denied | Guardian denies notifications | Status stays "Push queued" or "Not delivered", never "On it"; she still has the text path |
| 12 | Android SMS | Hold SOS on Android | Status "Text opened" until she sends; never "delivered" |
| 13 | iOS SMS | Hold SOS on iPhone, send / cancel | "Text sent" after send; "Waiting" after cancel |
| 14 | Shake to SOS | Enable, shake hard 3 times with the app open | Starts once; no trigger while walking normally for 10 min in a pocket |
| 15 | SafeWalk missed check-in | 2-min interval, ignore it, keep phone locked | Circle alerted within 4 min (needs the minute pinger); she gets "You missed a check-in" |
| 16 | Audio recording | Enable, run SOS 2 min, cancel | Audio in vault, plays back, fingerprint shown |
| 17 | Vault large file | Upload a 20 MB video on 3G | Upload completes or fails clearly; no partial item shown |
| 18 | Quick exit | Tap quick exit | Calculator shown; app switcher shows calculator |
| 19 | Accessibility | TalkBack / VoiceOver, large text 200 % | SOS button reachable and announced; no clipped text on SOS screen |
| 20 | Languages | Hindi and Bengali | No truncated labels on SOS screen and PIN pad |

## Results log

| Date | Tester | Device | Build | Cases run | Failures | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |
