-- ============================================================
-- GreenPulse Auth Schema (Postgres / Neon) — run AFTER schema-neon.sql
-- Adds real user accounts, sessions, and login history.
-- Run in the Neon SQL Editor, same as schema-neon.sql.
-- ============================================================

CREATE TABLE users (
  user_id             SERIAL PRIMARY KEY,
  email               VARCHAR(255) NOT NULL UNIQUE,
  password_hash       VARCHAR(255) NOT NULL,
  full_name           VARCHAR(150) NOT NULL,
  accommodation_type  VARCHAR(50),
  occupants           INTEGER DEFAULT 1,
  monthly_budget      NUMERIC(10,2) DEFAULT 60,
  green_score         INTEGER DEFAULT 100, -- placeholder until real scoring is built
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE auth_sessions (
  token       VARCHAR(64) PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at  TIMESTAMP DEFAULT NOW(),
  expires_at  TIMESTAMP NOT NULL
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE login_history (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  logged_in_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_login_history_user ON login_history(user_id);

-- Deleting a user cascades to their sessions and login history
-- automatically (ON DELETE CASCADE above). Appliances/timers/budget
-- aren't tied to users yet -- that migration is the next step.
