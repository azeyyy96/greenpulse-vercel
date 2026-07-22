-- ============================================================
-- GreenPulse — admin support (Postgres / Neon)
-- Run AFTER schema-neon.sql, schema-auth-neon.sql, schema-v3-neon.sql.
-- ============================================================

-- Reuses the existing login system — an admin is just a user account
-- with this flag set, not a separate auth mechanism.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Single-row table holding the tariff constants that used to be
-- hardcoded in the app's JS. The app fetches this (via the existing
-- public /api/catalog?resource=tariff endpoint) so admin edits here
-- take effect for every user immediately, with no redeploy.
CREATE TABLE tariff_settings (
  id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  rate_low_sen        NUMERIC(10,4) NOT NULL DEFAULT 44.43,  -- sen/kWh at or below the threshold
  rate_high_sen       NUMERIC(10,4) NOT NULL DEFAULT 54.43,  -- sen/kWh above the threshold
  rate_threshold_kwh  NUMERIC(10,2) NOT NULL DEFAULT 1500,
  retail_charge_rm    NUMERIC(10,2) NOT NULL DEFAULT 10,
  retail_waiver_kwh   NUMERIC(10,2) NOT NULL DEFAULT 600,    -- retail charge waived at/below this usage
  minimum_bill_rm     NUMERIC(10,2) NOT NULL DEFAULT 3,
  updated_at          TIMESTAMP DEFAULT NOW()
);
INSERT INTO tariff_settings (id) VALUES (1);

-- Energy Efficiency Incentive rebate bands (tiered discount by total
-- monthly kWh). Seeded with the same 16 bands already used in the app.
CREATE TABLE eei_bands (
  id           SERIAL PRIMARY KEY,
  min_kwh      NUMERIC(10,2) NOT NULL,
  max_kwh      NUMERIC(10,2) NOT NULL,
  rebate_sen   NUMERIC(10,4) NOT NULL,
  sort_order   INTEGER NOT NULL
);
INSERT INTO eei_bands (min_kwh, max_kwh, rebate_sen, sort_order) VALUES
(0,200,25.00,1),(201,250,24.00,2),(251,300,22.50,3),(301,350,20.00,4),
(351,400,18.00,5),(401,450,15.00,6),(451,500,12.00,7),(501,550,10.00,8),
(551,600,8.00,9),(601,650,6.00,10),(651,700,5.00,11),(701,750,4.00,12),
(751,800,3.00,13),(801,850,2.00,14),(851,900,1.00,15),(901,1000,0.50,16);

-- ------------------------------------------------------------
-- One-time step: make your own account an admin. Run this yourself
-- with your actual email -- there's no self-service way to become
-- admin, by design.
-- ------------------------------------------------------------
-- UPDATE users SET is_admin = TRUE WHERE email = 'your-email@example.com';
