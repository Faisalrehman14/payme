# Globa Pay

Multi-office Cash App / Lightning payment platform with admin controls, office dashboards, commission fees, and secure payouts.

## Production checklist (Railway)

Set these variables before onboarding offices:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL |
| `PUBLIC_BASE_URL` | Yes | e.g. `https://globa-cash.us` |
| `ADMIN_USERNAME` | Yes | Admin portal login |
| `ADMIN_PASSWORD` | Yes | Strong password (12+ chars, letter + number) |
| `ALBY_LIGHTNING_ADDRESS` | Yes* | e.g. `you@getalby.com` |
| `ALBY_API_TOKEN` | Yes* | Alby developer token (`invoices` + payments) |
| `NWC_URL` | Optional | Only if not using Alby cloud token |

\* Cloud Alby setup is recommended so payments work 24/7 without your laptop.

On startup, production mode **refuses to boot** if secrets are missing/weak or Postgres is not configured.

## Office onboarding (your daily workflow)

1. Open `/admin` and sign in.
2. **Offices → Create Office** (name + slug).
3. Copy the office payment link (`/pay/slug`) and share with customers.
4. **Users → Create Office User**
   - Pick the office
   - Enter username
   - Click **Generate Password** (or leave blank to auto-generate)
   - Create user and share username + temporary password once
5. Optional: set **Fee %** (e.g. 15% → office can withdraw 85%).
6. Optional: **Enable Payouts** only for offices you trust to withdraw.

Office staff use `/dashboard` to track payments and (if enabled) withdraw via Lightning invoice.

## Local development

```bash
cp .env.example .env
npm install
npm run dev
npm test
```

Without `DATABASE_URL`, the app uses JSON file storage (dev only).

## Security features

- Production env validation (hard fail on bad secrets)
- Secure cookies + security headers + CSP
- Login + invoice API rate limits
- Deactivated offices cannot log in
- Ledger-based payout balances with race-safe caps
- Platform wallet liquidity check before payouts
- Strong password policy for admin/office accounts
- Graceful shutdown on `SIGTERM`

## Key URLs

- Customer pay: `/pay/{office-slug}`
- Office dashboard: `/dashboard`
- Admin: `/admin`
- Health: `/api/health`
