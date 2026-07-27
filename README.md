# JD Thornton Field Ledger

Tree inventory, farm-zone mapping, field-work milestones, and client allocation
tracking for JD Thornton Nurseries.

## Platform

- Next.js 16 on Firebase App Hosting
- Firebase Authentication with Google sign-in
- verified `@jdtnurseries.com` accounts only
- Cloud Firestore for inventory, allocations, and work history
- Cloud Storage for private tree-group photos
- Google Cloud project: `jdt-command-board`
- Firebase App Hosting backend: `jd-thornton-field-ledger`

The app uses Firebase Admin SDK calls behind authenticated API routes. Firestore
and Storage Security Rules deny direct browser access, so inventory validation,
concurrency checks, and work-history logging cannot be bypassed.

## Local development

Prerequisites:

- Node.js 22+
- pnpm 11+
- Google Application Default Credentials for server-side Firestore access

```bash
pnpm install
pnpm dev
```

The Firebase web configuration is public client configuration. Server credentials
are never stored in this repository; local development uses Application Default
Credentials and production uses the App Hosting service account.

## Validation

```bash
pnpm lint
pnpm test
pnpm build
```

## Deployment

The Firebase project is pinned in `.firebaserc`. App Hosting runtime and
environment configuration live in `apphosting.yaml`.

```bash
firebase deploy --only firestore,storage
firebase deploy --only apphosting:jd-thornton-field-ledger
```

## Production data migration

The migration script imports the protected production CSV exports into isolated
`fieldLedger*` Firestore collections and stops if those collections already
contain data.

```bash
node scripts/migrate-to-firestore.mjs <inventory.csv> <work-log.csv>
```

The source exports are intentionally excluded from GitHub by the
`migration-private/` ignore rule. Live inventory and customer data belong in
Firestore backups, not source-control history.

