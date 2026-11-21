# Notes for updating the project document (Chapter 4 and Chapter 5)

The project document (`SmartWasteMgt 249074317 MIT.docx`) was written before the system
existed, so Chapter 4 says what "should" happen. The system now exists. These notes give
the facts to turn each section into what **was** done. Section numbers match the document.
Copy the wording or rephrase it; the facts are exact.

Rule followed throughout: only report what is built and tested. Route optimisation, IoT
sensors and push notifications to a locked phone are **not** built and must not be claimed.

---

## 4.2 Implementation Environment — Table 4.1 (actual choices)

| Component | Actually implemented | Purpose |
| --- | --- | --- |
| Mobile application | React Native with Expo SDK 57 (TypeScript), Expo Router for screens. Android APK built locally with Gradle. Also runs in Expo Go and in a web browser. | Citizen and field-officer interfaces |
| Back-end API | Node.js 24, Express 5, TypeScript, Prisma 7 (database access), Zod (input validation), JSON Web Tokens (sign-in), bcrypt (password hashing), Helmet (security headers), rate limiting, Pino (logs) | Authentication, validation, business rules, notifications |
| Database | PostgreSQL 17. In development an embedded PostgreSQL is started by npm; in production any managed PostgreSQL (for example Neon or Supabase) is used through `DATABASE_URL`. | Persistent records: users, reports, photos, assignments, status history, notifications |
| Media storage | Photos are resized on the phone (longest side 1280 px, JPEG quality 0.7), then stored by the API on disk (`UPLOADS_DIR`) and served through signed, time-limited links (24 hours). Swapping to cloud object storage is a configuration step, not a redesign. | Waste-report photographs |
| Maps / location | Phone GPS through Expo Location; street name through the phone's own geocoder; maps drawn with Leaflet and OpenStreetMap tiles (no API key needed) | Location capture, pin confirmation and map display |
| Admin interface | React 19 + Vite 8 web dashboard (responsive) | Report validation, assignment, monitoring |
| Version control | Git, hosted on GitHub (`github.com/d4mie/smart-waste`) | Source-code management and change tracking |
| Testing | Vitest + Supertest: 97 automated tests (82 API, 15 shared rules) run against a real throwaway PostgreSQL | Regression testing |

The project is a single repository (monorepo) with four parts: `apps/api`, `apps/mobile`,
`apps/admin` and `packages/shared`. The shared package holds the roles, the report
statuses and the table of allowed status changes, so the phone app, the dashboard and the
API can never disagree about the workflow.

## 4.3 Mobile Application Modules (what each module does now)

**4.3.1 Authentication.** Sign in with email or Nigerian phone number (numbers like
`0803…`, `+234803…` and `234803…` are normalised to one format) and password. Passwords
must be at least 8 characters. Sign-in returns an access token (valid 1 hour) and a refresh
token (valid 30 days) stored securely on the phone; the app refreshes silently. Wrong
credentials show "The email/phone or password is incorrect". Sign-in attempts are limited
to 20 per 15 minutes per address.

**4.3.2 Citizen Home Dashboard.** Greeting, counts of open and resolved reports, a
"Report a waste problem" button, the list of the citizen's reports (newest first, with
status badges), a notification bell with unread count, and — when relevant — a yellow card
"N report(s) not sent yet" that opens the outbox.

**4.3.3 New Waste Report.** Category (chips loaded from the server), description (5–1000
characters), up to 3 photos (camera only, resized on the phone), and location. The
form is validated on the phone before anything is sent; the missing field is highlighted.
Sending shows real upload progress ("Sending… 40%"). Each report carries a unique
idempotency key (a random ID generated on the phone), so a retry can never create a
duplicate.

**4.3.4 Report Tracking.** The report detail screen shows the reference (for example
`SW-1042`), status badge, category, priority, description, photos, the location pin on a
map with an "Open in maps" link, dates, and a timeline of every status change (who, when,
and any note).

**4.3.5 Notifications.** In-app notifications are created by the server for every status
change on the citizen's report (validated, assigned, in progress, resolved, closed,
rejected) and for the field officer (new task, task reassigned). The bell shows the unread
count; the Notifications screen lists them with unread dots, "Tap to open" the report, and
"Mark all as read".

**4.3.6 Field / Collector Module.** Signing in as a field officer opens "My tasks": Active
and Completed tabs with counts; active tasks are ordered highest priority first, then
oldest first. The task detail shows who assigned it, when, the instruction, the due date,
the citizen's description, photos and map. Actions: **Acknowledge task**, **Start work**
(also acknowledges), and **Mark as resolved** with an optional completion note. Each action
updates the status history and notifies the citizen.

## 4.4 Administrative Dashboard Modules

- **Dashboard**: counts of citizens, field officers and administrators; total reports;
  reports open for more than 72 hours; API status; reports by status.
- **Report queue**: filter by status, priority and category; search by reference,
  description or address; paging.
- **Report detail**: description, photos, map link, citizen contact, full timeline;
  actions **Validate**, **Reject** (with reason), **Assign / Reassign** to a field officer
  (with instruction and optional due date), change **Priority**, **Close** after resolution.
  The page also warns when another open report is within 100 metres, and when this
  citizen has had 3 or more other reports rejected. Neither warning blocks an action.
- **Users**: list and search by role, create field officers and administrators,
  enable/disable accounts (a disabled account is signed out and cannot sign in).
- **Categories**: add and rename report categories, activate/deactivate.

## 4.5 Cloud Back-end Implementation (facts)

The API exposes these endpoints (all except `/health`, register and login require a valid
access token; role checks are enforced on the server):

| Area | Endpoints |
| --- | --- |
| Health | `GET /health` |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` |
| Categories | `GET /categories` |
| Reports | `POST /reports` (multipart with up to 3 photos), `GET /reports/my`, `GET /reports/my/counts`, `GET /reports/:id`, `PATCH /reports/:id/status`, `PATCH /reports/:id/priority` (admin), `POST /reports/:id/assign` (admin) |
| Media | `GET /media/:id` (signed link) |
| Field tasks | `GET /tasks/my`, `GET /tasks/my/counts`, `GET /tasks/:id`, `POST /tasks/:id/acknowledge` |
| Notifications | `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read-all`, `PATCH /notifications/:id/read` |
| Admin | `GET /admin/reports`, `GET /admin/reports/:id`, `GET/POST/PATCH /admin/users`, `GET/POST/PATCH /admin/categories`, `GET /admin/stats` |

Business rules live in one place on the server:

- **Status workflow**: NEW → VALIDATED → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED, with
  REJECTED possible from NEW/VALIDATED. Who may make each change is fixed: administrators
  validate, reject, assign and close; field officers move their own task to IN_PROGRESS and
  RESOLVED. Any other change is refused with HTTP 409 `INVALID_TRANSITION`.
- **History**: every change writes a `StatusHistory` row (old status, new status, who,
  when, note). This is the auditable trail required by FR-10.
- **Notifications**: written in the same database transaction as the status change, so a
  status can never change without its notification being recorded (FR-08).
- **Unique reference**: `SW-` plus a sequence number from the database, so two reports can
  never share a reference.
- **Idempotent submission**: `POST /reports` accepts an idempotency key; a repeat with the
  same key returns the original report (HTTP 201 with header `Idempotent-Replayed: true`)
  instead of creating a second one.
- **Errors**: one JSON shape for every error, `{ "error": { "code", "message", "details" } }`,
  with field-level details for validation errors (HTTP 400 `VALIDATION_ERROR`).

Security (matches 3.12): passwords hashed with bcrypt (cost 12); JWT access tokens (1 hour)
and rotating refresh tokens (30 days, revocable); role-based access control on every
route (HTTP 403 `FORBIDDEN`); Helmet security headers; CORS restricted to the dashboard
origin; rate limits on sign-in (20 / 15 min) and report creation (7 / 24 hours); photo uploads
limited to JPEG/PNG/WebP, 5 MB each, 3 per report; photo links are signed and expire;
citizens can only read their own reports and notifications.

## 4.6 Error and Connectivity Handling (what the app actually does)

1. The form is checked on the phone first. Nothing is sent until category, description
   and location are valid; the missing field is highlighted.
2. On "Send", the report is **saved on the phone first** (an "outbox"), then sent with a
   progress bar and a 90-second timeout.
3. If the server confirms, the saved copy is removed and the app shows **"Report sent"**
   with the reference number.
4. If the network fails or times out, the app shows **"Not sent yet"** with the reason and
   two buttons: **Retry now** and **Keep for later**. It never shows "Report sent" in this
   case (this is test T09).
5. The home screen shows "N report(s) not sent yet"; the outbox screen lets the user
   retry one, retry all, or delete. Retries reuse the same idempotency key, so the server
   never stores a duplicate even if the first attempt did reach it.
6. If the server rejects the report (validation error), the saved copy is removed and the
   field errors are shown, so an invalid report is not kept waiting.

The interface therefore distinguishes three states: **draft/not sent yet** (saved on the
phone), **sending** (progress), and **server-confirmed** (reference number shown).

## 4.7 Screenshot and Interface Evidence

Use the images in `docs/screenshots/`; the mapping to Figures 4.1–4.7 is in
`docs/figures.md`.

## 4.8 Testing Strategy — Table 4.2

Replace the expected results with the actual results from `docs/test-results.md`:
all 10 functional test cases **passed** on 12 September 2026 against the running system.
Also state that 97 automated tests (unit and API integration tests) run on every change.

## 4.9 Evaluation Metrics — what can be reported now

Measured on the development machine (MacBook, embedded PostgreSQL, local network):

| Indicator | Result / how to state it |
| --- | --- |
| Successful report-submission rate | 100 % in the test run (every valid report was stored once; invalid ones were rejected with the field named). |
| Error rate | 0 unexpected server errors during the functional run; all failures were intended (401, 400, 403, 409). |
| Number of completed report workflows | The full workflow NEW → VALIDATED → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED was completed end-to-end in the run (see T06–T10). |
| Notification delivery success | 5 of 5 status notifications delivered for the test report (validated, assigned, in progress, resolved, closed) — T10. |
| Basic security checks | Wrong password → 401; citizen on admin route → 403; forbidden status change → 409; security headers present (automated tests). |
| Response time | Local API responses for login, report list and report detail completed well under one second in the run. Give measured numbers after deployment (see below). |
| Uptime during the test period | Not measurable meaningfully on a laptop. Report it after hosting (see below). |
| Usability feedback | Not yet collected. Recommended: a short questionnaire (5–10 users) after the Redmi test. |

To report response time and uptime honestly after deployment: host the API (see README
deployment notes), then use the `/health` endpoint with a free uptime monitor (for example
UptimeRobot, 5-minute checks) for at least one week, and record average response time
from the same monitor.

## 4.10 / 4.11 and Chapter 5 — suggested wording points

- Say clearly what was built: citizen app, field-officer app, admin dashboard, API and
  database, with tested workflow, history and notifications.
- **Limitations (5.4)**: notifications are in-app only (no push to a locked phone); photos
  are stored on the API's disk rather than cloud object storage; the app was tested on
  Android only; usability testing with real citizens has not yet been done; route
  optimisation and IoT bins are not implemented.
- **Future work (5.5)**: push notifications (Firebase Cloud Messaging), cloud object
  storage for photos, iOS build, analytics on the accumulated report data (hotspots by
  ward, average time to resolve), SMS notifications for citizens without data, and
  integration with LAWMA/PSP operator systems.

## Deployment steps that need Mr. Gaawa's own accounts

These were not done because they need personal accounts and passwords:

1. **Database**: create a free PostgreSQL on Neon or Supabase; copy the connection string
   into `DATABASE_URL`.
2. **API**: deploy `apps/api` to Render or Railway (Node 24). Set `DATABASE_URL`,
   `JWT_SECRET`, `CORS_ORIGINS` (the dashboard address), `PUBLIC_URL` (the API address),
   `NODE_ENV=production`, and `UPLOADS_DIR` on a persistent disk. Run `prisma migrate
   deploy` and the seed once.
3. **Admin dashboard**: deploy `apps/admin` to Vercel or Netlify with `VITE_API_URL` set
   to the API address.
4. **Phone app**: rebuild the APK with `EXPO_PUBLIC_API_URL=https://<api-address>` so it
   points at the hosted API (see README, "Android APK").
