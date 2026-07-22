-- ============================================================
-- GreenPulse — per-user data + OTP tables (Postgres / Neon)
-- Run AFTER schema-neon.sql and schema-auth-neon.sql.
-- ============================================================

-- ---- Per-user appliance data (replaces browser-only state) ----
CREATE TABLE user_appliances (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  brand           VARCHAR(100) NOT NULL,
  appliance_type  VARCHAR(50) NOT NULL,
  model           VARCHAR(150),
  watt            INTEGER NOT NULL,
  hours           NUMERIC NOT NULL,
  usage_time      VARCHAR(20) NOT NULL DEFAULT 'day',
  created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_user_appliances_user ON user_appliances(user_id);

CREATE TABLE usage_sessions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  appliance_id  INTEGER NOT NULL REFERENCES user_appliances(id) ON DELETE CASCADE,
  start_at      TIMESTAMPTZ NOT NULL,
  end_at        TIMESTAMPTZ
);
CREATE INDEX idx_usage_sessions_user ON usage_sessions(user_id);
CREATE INDEX idx_usage_sessions_appliance ON usage_sessions(appliance_id);

CREATE TABLE monthly_usage_log (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  month_key  VARCHAR(7) NOT NULL, -- 'YYYY-MM'
  entries    JSONB NOT NULL,
  UNIQUE(user_id, month_key)
);

-- ---- OTP tables for email verification + password reset ----
CREATE TABLE pending_registrations (
  email               VARCHAR(255) PRIMARY KEY,
  password_hash       VARCHAR(255) NOT NULL,
  full_name           VARCHAR(150) NOT NULL,
  accommodation_type  VARCHAR(50),
  occupants           INTEGER,
  monthly_budget      NUMERIC(10,2),
  otp_code            VARCHAR(6) NOT NULL,
  otp_expires_at      TIMESTAMP NOT NULL,
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE password_reset_otps (
  email           VARCHAR(255) PRIMARY KEY,
  otp_code        VARCHAR(6) NOT NULL,
  otp_expires_at  TIMESTAMP NOT NULL,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Registering a new account no longer writes to `users` directly --
-- it writes to pending_registrations until the OTP is verified, at
-- which point api/auth/verify-registration.js moves it into `users`.
