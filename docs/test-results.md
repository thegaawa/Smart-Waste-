# Test results (Table 4.2 evidence)

This file records the real results of the functional test cases in **Table 4.2** of the
project document, run against the working system. Nothing here is expected or planned;
every row was executed and observed.

- Date of run: 12 September 2026
- API: `smart-waste-api` v0.1.0 on `http://localhost:4000` (embedded PostgreSQL 17, `database: up`)
- Mobile app: Expo SDK 57 build of `apps/mobile`, run in the browser (React Native Web) for screenshots
- Admin dashboard: `apps/admin` (Vite dev server, `http://localhost:5173`)
- Accounts: the seeded demo accounts (`citizen@smartwaste.local`, `field@smartwaste.local`, `admin@smartwaste.local`)

## Table 4.2 — live run (10 / 10 passed)

| Test ID | Scenario | Expected result | Final result | Evidence observed |
| --- | --- | --- | --- | --- |
| T01 | Valid citizen login | User is authenticated and citizen dashboard opens. | **Passed** | `POST /auth/login` → HTTP 200, `role = CITIZEN`, access token issued. Citizen home opens (Figure 4.2). |
| T02 | Invalid login | Access is denied with clear validation message. | **Passed** | HTTP 401, `code = UNAUTHORIZED`, message "The email/phone or password is incorrect". |
| T03 | Submit complete waste report | Report is stored and unique reference/status returned. | **Passed** | `POST /reports` (multipart, 1 photo) → HTTP 201, `reference = SW-1001`, `status = NEW`, `photos = 1`. |
| T04 | Submit report without required field | Client/server rejects submission and identifies missing field. | **Passed** | HTTP 400, `code = VALIDATION_ERROR`, `details.fields = [categoryId]`. The app also blocks the form and marks the field before sending. |
| T05 | Capture/confirm location | Coordinates are attached to the report and viewable on map. | **Passed** | `GET /reports/:id` → `latitude = 6.6018`, `longitude = 3.3515`, `address = "Obafemi Awolowo Way, Ikeja"`. Pin shown on the map in the report detail (Figure 4.5). |
| T06 | Admin assigns report | Assignment is stored and appears for selected field user. | **Passed** | Admin validate → HTTP 200; assign → HTTP 200, `status = ASSIGNED`, `assignee = Team A Field Officer`. Field officer's `GET /tasks/my` contains SW-1001 (Figure 4.6). |
| T07 | Field user updates status | Status history changes and citizen sees updated state. | **Passed** | Acknowledge → HTTP 200 (`ACKNOWLEDGED`); `IN_PROGRESS` → HTTP 200; `RESOLVED` → HTTP 200. Citizen's copy shows `status = RESOLVED` and history `NEW → VALIDATED → ASSIGNED → IN_PROGRESS → RESOLVED`. |
| T08 | Citizen attempts admin endpoint | Request is denied by role-based access control. | **Passed** | `GET /admin/reports` with a citizen token → HTTP 403, `code = FORBIDDEN`. |
| T09 | Temporary network failure during submission | App shows failure/retry without falsely confirming submission. | **Passed** | App side: with the network cut, the form shows **"Not sent yet"** with *Retry now* / *Keep for later*; the home screen shows "1 report not sent yet"; nothing is marked as sent (screenshots `09a`–`09c`). After the network returns, *Retry* sends it and the outbox shows **"Sent · SW-1006"** (`09d`). Server side: the retry reused the same idempotency key → HTTP 201 with `Idempotent-Replayed: true`, same report id, report count before/after = 1/1 (no duplicate). |
| T10 | Report closure notification | Citizen receives completion notification and closed status. | **Passed** | Admin close → HTTP 200. Citizen's notifications contain "SW-1001: Report closed — E2E: confirmed with the citizen"; report `status = CLOSED`. Earlier messages were also delivered: "Validated by admin", "Assigned to field team", "Collection in progress", "Report resolved — …". |

Raw output of the run (API side) is reproduced below exactly as printed by the check script:

```
PASS  T01  Valid citizen login — HTTP 200, role=CITIZEN, access token issued
PASS  T02  Invalid login — HTTP 401, code=UNAUTHORIZED, message="The email/phone or password is incorrect"
PASS  T03  Submit complete waste report — HTTP 201, reference=SW-1001, status=NEW, photos=1
PASS  T04  Submit report without required field — HTTP 400, code=VALIDATION_ERROR, fields=[categoryId]
PASS  T05  Capture/confirm location — HTTP 200, latitude=6.6018, longitude=3.3515, address="Obafemi Awolowo Way, Ikeja"
PASS  T06  Admin assigns report — validate HTTP 200; assign HTTP 200, status=ASSIGNED, assignee=Team A Field Officer; field GET /tasks/my contains SW-1001: true
PASS  T07  Field user updates status — acknowledge HTTP 200 (ACKNOWLEDGED); IN_PROGRESS HTTP 200; RESOLVED HTTP 200; citizen sees status=RESOLVED, history: NEW → VALIDATED → ASSIGNED → IN_PROGRESS → RESOLVED
PASS  T08  Citizen attempts admin endpoint — GET /admin/reports as citizen → HTTP 403, code=FORBIDDEN
PASS  T09  Temporary network failure during submission (server side: retry with same key) — retry HTTP 201, Idempotent-Replayed=true, same id=true, reports before/after=1/1
PASS  T10  Report closure notification — close HTTP 200; citizen notification "SW-1001: Report closed — E2E: confirmed with the citizen"; status=CLOSED
10/10 passed
```

## Automated tests (run on every change)

The same behaviour is also covered by automated tests, so it stays correct as the code changes.
Run them with `npm test` from the repository root.

| Test file | Tests | Covers |
| --- | --- | --- |
| `apps/api/test/auth.test.ts` | 21 | Registration, login (T01, T02), token refresh, logout, rate limiting |
| `apps/api/test/rbac.test.ts` | 9 | Role checks on every protected route (T08) |
| `apps/api/test/reports.test.ts` | 22 | Report creation and validation (T03, T04, T05), status rules, idempotent retry (T09 server side), history |
| `apps/api/test/media.test.ts` | 5 | Photo upload limits and signed photo links |
| `apps/api/test/admin-reports.test.ts` | 8 | Admin queue, validate, assign (T06), priority, statistics |
| `apps/api/test/tasks.test.ts` | 5 | Field task list, acknowledge, status updates (T07) |
| `apps/api/test/notifications.test.ts` | 5 | Notifications on status changes and closure (T10), read state, access rules |
| `apps/api/test/categories.test.ts` | 2 | Category list and admin category management |
| `apps/api/test/health.test.ts` | 5 | Health check, security headers, error format |
| `packages/shared/src/reports.test.ts` | 7 | Status transition table shared by app, dashboard and API |
| `packages/shared/src/phone.test.ts` | 8 | Nigerian phone number normalisation |
| **Total** | **97** | All passing |

## How T09 was tested on the app side

1. The citizen filled the form (category, description, location) and pressed **Send report**.
2. The network was switched off in the browser just before sending.
3. The app saved the report on the device first, tried to send, and the request failed.
4. The form showed the yellow **"Not sent yet"** card (reason: "Could not reach the server…") with **Retry now** and **Keep for later**. It did **not** show "Report sent".
5. The home screen showed **"1 report not sent yet"**; the outbox screen listed the report with a *Not sent yet* badge.
6. The network was switched back on and **Retry** was pressed. The outbox showed **"Sent · SW-1006"** with an *Open report* link, and the waiting list became empty.
7. Because the retry reused the same idempotency key, the server created the report only once.

## Not covered by this run

- Push notifications to a locked phone (FCM) are not implemented; notifications are delivered inside the app (bell icon and Notifications screen).
- Load and uptime figures for a hosted deployment were not measured because the system was tested on a single development machine. See `document-updates.md` (section 4.9) for what can be reported and how to measure the rest after deployment.
