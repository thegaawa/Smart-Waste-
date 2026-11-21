# Smart-Waste

A phone and web system for reporting and managing waste problems in Lagos State
(MIT project, University of Lagos).

Citizens send a report from the phone app (photo, place, category).
Administrators review and assign work from a web dashboard.
Field officers update tasks on the phone app. The citizen is told when the status changes.

## What is in this repository

| Folder | What it is |
| --- | --- |
| `apps/api` | REST API (Node.js, Express, Prisma, PostgreSQL) |
| `apps/mobile` | Phone app for citizens and field officers (Expo / React Native) |
| `apps/admin` | Administrator web dashboard (React + Vite) |
| `packages/shared` | Shared types used by all three |

## Requirements

- Node.js 24 (`nvm use` reads `.nvmrc`)
- npm 11

The local database is started by npm. You do not need Docker or a separate PostgreSQL install.

## Run it locally

```bash
cd smart-waste
nvm use
npm install

cp apps/api/.env.example apps/api/.env
# set JWT_SECRET in apps/api/.env to a long random string

npm run db:start        # terminal 1
npm run db:migrate      # terminal 2
npm run db:seed

npm run api             # http://localhost:4000
npm run admin           # http://localhost:5173
npm run mobile          # Expo; scan the QR code
```

Copy `apps/mobile/.env.example` to `apps/mobile/.env` only if the phone app should use an API other than the computer running Expo.

Demo sign-in details are created by the seed script. They are for local development only. Do not reuse them on a public server.

## Checks

```bash
npm run typecheck
npm test
```

## More detail

School notes, test results and screenshot mapping live in `docs/`.
Environment variable names are in each app’s `.env.example`.
