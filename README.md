# GreenPulse — Vercel Deployment (free tier only)

Static dashboard + appliance database + real per-user accounts with OTP
email verification + an admin panel, all on free tiers: Vercel (Hobby),
Neon (Postgres), Resend (email). No paid services required.

## Structure

```
index.html                 Main app
login.html / register.html / forgot-password.html
admin.html                 Admin-only: manage appliance catalog + tariff rates

api/                        7 serverless functions (Hobby plan caps at 12 — see note below)
  catalog.js                 Public reads: types/brands/models/tariff (no login required)
  auth.js                     Register/verify/resend/login/logout/me/forgot/reset
  profile.js                   Update/password/delete/login-history
  appliances.js                  Per-user appliance CRUD
  sessions.js                      Per-user timer sessions
  tracker.js                         Per-user monthly usage log
  admin.js                             Admin-only: brand/model/tariff CRUD

lib/
  db.js / auth.js / email.js

schema-neon.sql            Appliance catalog — run 1st
schema-auth-neon.sql        Users, sessions, login history — run 2nd
schema-v3-neon.sql            Per-user appliances/timers/tracker + OTP — run 3rd
schema-admin-neon.sql            is_admin flag, tariff_settings, eei_bands — run 4th
```

## IMPORTANT: function count

Stay at or under **12 serverless functions total** (Vercel Hobby plan
hard limit — a deployment silently fails past this with no clear error
in the visible build log). Currently at **7**. If you need a new
backend feature, add an `action` to an existing consolidated file
(`admin.js`, `auth.js`, `profile.js`) rather than creating a new file,
unless there's a good reason to split further.

## Setting up the admin panel

1. Run `schema-admin-neon.sql` in the Neon SQL Editor (after the other
   three schema files, if you haven't run them already).
2. Make your own account an admin — there's no self-service way to do
   this, by design. In the Neon SQL Editor:
   ```sql
   UPDATE users SET is_admin = TRUE WHERE email = 'your-actual-email@example.com';
   ```
3. Log into the main app with that account. An "Admin" card now
   appears in your Account panel (tap the avatar in the header) with
   a link to `admin.html`. Or just visit `your-url.vercel.app/admin.html`
   directly.

## What the admin panel does

- **Brands** — add, rename, delete. Deleting a brand cascades to
  delete all its models too (the UI warns you with the model count
  before confirming).
- **Models** — add, edit, delete, filterable by type/brand. Every
  model here is exactly what populates the Register tab's Brand →
  Model dropdowns for every user.
- **Tariff & EEI** — the TNB-style rate structure (rate below/above
  the 1,500 kWh threshold, retail charge, retail waiver threshold,
  minimum bill) and the EEI rebate bands. These used to be hardcoded
  in the app's JS; they're now stored in the database and fetched by
  every user's browser on load (public read via `/api/catalog?resource=tariff`,
  cached 5 minutes). **Editing a rate here changes every user's bill
  calculation within a few minutes — no redeploy needed.**

## What the admin panel deliberately does NOT show

No access to `users`, `login_history`, `user_appliances`,
`usage_sessions`, or `monthly_usage_log` — nothing that's personal to
an individual user. The admin API (`api/admin.js`) only ever touches
`brands`, `appliance_models`, `tariff_settings`, and `eei_bands` — all
shared reference data, never anyone's private account data. This was
an explicit requirement, not an oversight to fix later.

## Access control

Admin status reuses the existing login system — it's the same
`users` table and the same session cookies, just with an `is_admin`
boolean checked on every admin API call. There's no separate admin
password or auth mechanism to keep track of.
