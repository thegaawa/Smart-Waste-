# Figures for section 4.7 (Screenshot and Interface Evidence)

Every figure named in the project document now has a real screenshot in `docs/screenshots/`.
The app images are 780 × 1688 px (phone size, 2× scale); the admin dashboard images are 1366 × 820 px.

| Figure in document | Screenshot file | What it shows |
| --- | --- | --- |
| Figure 4.1 Login / Registration Screen | `01-signin.png` | Sign-in form (email or phone + password) with the "Create account" link |
| Figure 4.2 Citizen Home Dashboard / Screen | `02-citizen-home.png` | Greeting, Open / Resolved counters, "Report a waste problem" button, "My reports" list, notification bell |
| Figure 4.3 New Waste Report Form / Screen | `03-new-report.png` | Category chips, description with counter, photos (up to 3), location block |
| Figure 4.4 Map / Location Confirmation Screen | `04-location.png` | Draggable pin on an OpenStreetMap map, coordinates, optional street/landmark, "Use my GPS" / "Use this location" |
| Figure 4.5 Report Detail and Status Timeline Screen | `05-report-detail.png` | "Report sent" confirmation with the SW reference, status badge, description, map pin, dates and timeline |
| Figure 4.6 Field Task Screen | `06-field-tasks.png` (list), `06b-field-task-detail.png` (task with *Acknowledge task* / *Start work*), `06c-field-task-in-progress.png` (task in progress with *Mark as resolved*) | Field officer's task list ordered by priority, task detail with instruction and actions |
| Figure 4.7 Administrative Report Dashboard | `07-admin-dashboard.png` (counters), `07b-admin-queue.png` (report queue with filters), `07c-admin-report.png` (report detail with timeline, priority and assign) | Admin web dashboard |

Extra screenshots that support the text of Chapter 4:

| File | Use in the document |
| --- | --- |
| `08-notifications.png` | 4.3.5 Notifications Module — unread dots, "Mark all as read" |
| `09a-not-sent-yet.png` | 4.6 Error and Connectivity Handling — the form after a failed send ("Not sent yet", Retry now / Keep for later) |
| `09b-home-outbox.png` | 4.6 — home screen while offline: "1 report not sent yet" card, honest "Could not reach the server" message |
| `09c-outbox-offline.png` | 4.6 — outbox list with the *Not sent yet* badge, Retry / Delete |
| `09d-outbox-sent.png` | 4.6 — after the network returns: "Sent · SW-1006", nothing left waiting |

## How these were captured

The app screenshots were taken from the same app code running in a desktop browser
(React Native Web) at phone width, using Playwright browser automation with the seeded demo
accounts. The admin screenshots are from the admin web dashboard. Data shown is demo data
created during the test run (references SW-1003 to SW-1006).

## If you prefer screenshots from a real phone

The app also runs on the Redmi. Steps:

1. Start the database, the API and the app on the laptop (`npm run db:start`, `npm run api`, `npm run mobile`, each in its own terminal — see README, "Running the apps"). Make sure the phone and the laptop are on the same Wi-Fi.
2. Install the APK from `builds/` (see README, "Android APK") **or** open the project in Expo Go by scanning the QR code.
3. Sign in as `citizen@smartwaste.local` / `Citizen123!` and go through: Home → Report a waste problem → Confirm location → Send → Report detail.
4. Sign out, sign in as `field@smartwaste.local` / `Field12345!` for the Field Task screen.
5. Take screenshots with Power + Volume Down on the phone.
6. Copy them into `docs/screenshots/` with the same names as above (replace the browser versions), so the document mapping in this file stays valid.

Note: on the phone, the location screen shows the street name from the phone's own
geocoder (for example "Obafemi Awolowo Way, Ikeja"); in the browser only the coordinates
are shown.
