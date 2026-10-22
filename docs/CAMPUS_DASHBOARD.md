# Campus dashboard: design (not built)

Status: **design only.** A dashboard for a college or employer changes who can see what, so it should be built with a real institution, a named operational owner and a signed data-processing agreement, not ahead of them. Nothing in the app today gives an institution any access.

## 1. What it is for

Help a campus safety team or Internal Committee fix places and services: lighting, guards, transport, response times, and staffing of the Internal Committee. It is **not** for watching students or employees.

## 2. What it may show (minimal disclosure)

| Shown | Rule |
| --- | --- |
| Area reports inside the campus boundary | Same rules as the app: 3+ different reporters in 90 days, moderation applies, place names only when 3 reporters agree. Counts by category and time band, weekly at most. |
| SOS volume on campus | Weekly count only, and only if 5 or more; never times, routes, names or the alert's location trail. |
| SafeWalk missed check-ins on campus | Weekly count only, threshold 5. |
| Average guardian response time | Aggregated over all alerts on campus that week, threshold 5. |
| Resources | The institution's own Internal Committee contacts, shown to users who opt in. |

Never shown to an institution: any person's identity, alerts, live location, trail, Pattern threads, vault contents, guardian lists, reports linked to a reporter, or anything about a single event. No export of row-level data. No ability to contact a user through SAAHI.

Small numbers: any cell under its threshold is shown as "fewer than 5", and adjacent weeks are not differenced (no "this week minus last week" view that could isolate one event).

## 3. Who can see it (RBAC)

| Role | Can |
| --- | --- |
| `org_viewer` | See the aggregates above for their organisation |
| `org_admin` | Viewer + manage the organisation's viewers and campus boundary (a polygon reviewed by SAAHI before activation) |
| `saahi_reviewer` | Activate organisations and boundaries; handle moderation flags. No access to individuals' data either. |

Accounts are separate from user accounts; sign-in requires a second factor. Every dashboard view and admin action goes to an audit log the organisation and SAAHI can both read. Access expires with the agreement.

## 4. Data model (when built)

`orgs(id, name, agreement_ref, active_until)`, `org_members(org_id, user_id, role)`, `org_boundaries(org_id, geohash6 list, approved_by, approved_at)`, `org_audit(org_id, actor_id, action, at)`. Aggregates are computed by queries that enforce the thresholds in SQL, so the API can never return a row under the threshold. No new columns on user tables.

## 5. Users' consent

A user's activity is counted only if she opts in to "Help my campus improve" in Settings, which names the organisation and what it sees. Opting out removes her from future aggregates.

## 6. Before building

1. A partner institution and a named owner for acting on the data.
2. Data-processing agreement and a legal review (India's Digital Personal Data Protection Act, 2023, and the institution's own policies).
3. A threat review of the thresholds with the partner's real numbers.
4. Tests that call every dashboard endpoint with seeded data just under each threshold and assert nothing is returned.
