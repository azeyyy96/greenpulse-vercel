import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../lib/db.js';
import { newToken, sessionExpiry, setSessionCookie, clearSessionCookie, parseCookies, getUserFromRequest, SESSION_COOKIE_NAME } from '../lib/auth.js';
import { sendOtpEmail } from '../lib/email.js';

// Consolidates the old auth/register.js, verify-registration.js,
// resend-otp.js, login.js, logout.js, me.js, forgot-password.js, and
// reset-password.js into one function, to stay well under Vercel
// Hobby's 12-serverless-function limit.
//
//   GET  /api/auth                       -> current user (was auth/me)
//   POST /api/auth  { action, ... }      -> everything else, dispatched by action

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  const sql = db();

  if (req.method === 'GET') {
    try {
      const user = await getUserFromRequest(req, sql);
      if (!user) { res.status(401).json({ error: 'Not logged in' }); return; }
      res.status(200).json({ user });
    } catch (err) {
      console.error('[api/auth]', err);
      res.status(500).json({ error: 'Database error' });
    }
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { action } = req.body || {};

  // ---- register: create a pending registration + email an OTP ----
  if (action === 'register') {
    const { fullName, email, password, accommodationType, occupants, budget } = req.body || {};
    if (!fullName || !email || !password) {
      res.status(400).json({ error: 'Full name, email and password are required.' }); return;
    }
    if (!EMAIL_RE.test(email)) { res.status(400).json({ error: 'Please enter a valid email.' }); return; }
    if (password.length < 8) { res.status(400).json({ error: 'Password must contain at least 8 characters.' }); return; }

    try {
      const existing = await sql`SELECT user_id FROM users WHERE email = ${email.toLowerCase()}`;
      if (existing.length > 0) { res.status(409).json({ error: 'An account with this email already exists.' }); return; }

      const hash = await bcrypt.hash(password, 10);
      const otp = String(crypto.randomInt(100000, 1000000));
      const expires = new Date(Date.now() + 10 * 60 * 1000);

      await sql`
        INSERT INTO pending_registrations
          (email, password_hash, full_name, accommodation_type, occupants, monthly_budget, otp_code, otp_expires_at)
        VALUES
          (${email.toLowerCase()}, ${hash}, ${fullName}, ${accommodationType || null}, ${occupants || 1}, ${budget || 60}, ${otp}, ${expires.toISOString()})
        ON CONFLICT (email) DO UPDATE SET
          password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name,
          accommodation_type = EXCLUDED.accommodation_type, occupants = EXCLUDED.occupants,
          monthly_budget = EXCLUDED.monthly_budget, otp_code = EXCLUDED.otp_code, otp_expires_at = EXCLUDED.otp_expires_at
      `;
      await sendOtpEmail(email, otp, 'verify');
      res.status(200).json({ pendingVerification: true, email: email.toLowerCase() });
    } catch (err) {
      console.error('[api/auth]', err);
      res.status(500).json({ error: 'Something went wrong creating your account.' });
    }
    return;
  }

  // ---- verify: check OTP, create the real account, log in ----
  if (action === 'verify') {
    const { email, otp } = req.body || {};
    if (!email || !otp) { res.status(400).json({ error: 'Email and code are required.' }); return; }
    try {
      const rows = await sql`SELECT * FROM pending_registrations WHERE email = ${email.toLowerCase()}`;
      const pending = rows[0];
      if (!pending) { res.status(404).json({ error: 'No pending registration found for this email. Please register again.' }); return; }
      if (new Date(pending.otp_expires_at).getTime() < Date.now()) { res.status(410).json({ error: 'This code has expired. Please request a new one.' }); return; }
      if (pending.otp_code !== String(otp)) { res.status(401).json({ error: 'Incorrect verification code.' }); return; }

      const userRows = await sql`
        INSERT INTO users (email, password_hash, full_name, accommodation_type, occupants, monthly_budget)
        VALUES (${pending.email}, ${pending.password_hash}, ${pending.full_name}, ${pending.accommodation_type}, ${pending.occupants}, ${pending.monthly_budget})
        RETURNING user_id, email, full_name, accommodation_type, occupants, monthly_budget, green_score, created_at
      `;
      const user = userRows[0];
      await sql`DELETE FROM pending_registrations WHERE email = ${pending.email}`;

      const token = newToken();
      const expires = sessionExpiry();
      await sql`INSERT INTO auth_sessions (token, user_id, expires_at) VALUES (${token}, ${user.user_id}, ${expires.toISOString()})`;
      await sql`INSERT INTO login_history (user_id) VALUES (${user.user_id})`;
      setSessionCookie(res, token);
      res.status(200).json({ user });
    } catch (err) {
      console.error('[api/auth]', err);
      res.status(500).json({ error: 'Something went wrong verifying your account.' });
    }
    return;
  }

  // ---- resend: issue a fresh OTP for a pending registration ----
  if (action === 'resend') {
    const { email } = req.body || {};
    if (!email) { res.status(400).json({ error: 'Email is required.' }); return; }
    try {
      const rows = await sql`SELECT email FROM pending_registrations WHERE email = ${email.toLowerCase()}`;
      if (rows.length === 0) { res.status(404).json({ error: 'No pending registration found. Please register again.' }); return; }
      const otp = String(crypto.randomInt(100000, 1000000));
      const expires = new Date(Date.now() + 10 * 60 * 1000);
      await sql`UPDATE pending_registrations SET otp_code = ${otp}, otp_expires_at = ${expires.toISOString()} WHERE email = ${email.toLowerCase()}`;
      await sendOtpEmail(email, otp, 'verify');
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[api/auth]', err);
      res.status(500).json({ error: 'Could not resend code.' });
    }
    return;
  }

  // ---- login ----
  if (action === 'login') {
    const { email, password } = req.body || {};
    if (!email || !password) { res.status(400).json({ error: 'Please enter your email and password.' }); return; }
    try {
      const rows = await sql`SELECT * FROM users WHERE email = ${email.toLowerCase()}`;
      const user = rows[0];
      if (!user) { res.status(401).json({ error: 'Email address not found.' }); return; }
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) { res.status(401).json({ error: 'Incorrect password.' }); return; }

      const token = newToken();
      const expires = sessionExpiry();
      await sql`INSERT INTO auth_sessions (token, user_id, expires_at) VALUES (${token}, ${user.user_id}, ${expires.toISOString()})`;
      await sql`INSERT INTO login_history (user_id) VALUES (${user.user_id})`;
      setSessionCookie(res, token);
      const { password_hash, ...safeUser } = user;
      res.status(200).json({ user: safeUser });
    } catch (err) {
      console.error('[api/auth]', err);
      res.status(500).json({ error: 'Something went wrong logging in.' });
    }
    return;
  }

  // ---- logout ----
  if (action === 'logout') {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) {
      try { await sql`DELETE FROM auth_sessions WHERE token = ${token}`; } catch (err) { /* non-fatal */ }
    }
    clearSessionCookie(res);
    res.status(200).json({ ok: true });
    return;
  }

  // ---- forgot: email a reset OTP if the account exists ----
  if (action === 'forgot') {
    const { email } = req.body || {};
    if (!email) { res.status(400).json({ error: 'Please enter your email.' }); return; }
    try {
      const users = await sql`SELECT user_id FROM users WHERE email = ${email.toLowerCase()}`;
      if (users.length > 0) {
        const otp = String(crypto.randomInt(100000, 1000000));
        const expires = new Date(Date.now() + 10 * 60 * 1000);
        await sql`
          INSERT INTO password_reset_otps (email, otp_code, otp_expires_at)
          VALUES (${email.toLowerCase()}, ${otp}, ${expires.toISOString()})
          ON CONFLICT (email) DO UPDATE SET otp_code = EXCLUDED.otp_code, otp_expires_at = EXCLUDED.otp_expires_at
        `;
        await sendOtpEmail(email, otp, 'reset');
      }
      // Always success either way -- doesn't reveal which emails exist.
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[api/auth]', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
    return;
  }

  // ---- reset: verify OTP, set new password, log in ----
  if (action === 'reset') {
    const { email, otp, newPassword } = req.body || {};
    if (!email || !otp || !newPassword) { res.status(400).json({ error: 'Email, code, and new password are required.' }); return; }
    if (newPassword.length < 8) { res.status(400).json({ error: 'Password must contain at least 8 characters.' }); return; }
    try {
      const rows = await sql`SELECT * FROM password_reset_otps WHERE email = ${email.toLowerCase()}`;
      const rec = rows[0];
      if (!rec) { res.status(404).json({ error: 'No reset request found for this email. Please request a new code.' }); return; }
      if (new Date(rec.otp_expires_at).getTime() < Date.now()) { res.status(410).json({ error: 'This code has expired. Please request a new one.' }); return; }
      if (rec.otp_code !== String(otp)) { res.status(401).json({ error: 'Incorrect code.' }); return; }

      const hash = await bcrypt.hash(newPassword, 10);
      const userRows = await sql`UPDATE users SET password_hash = ${hash} WHERE email = ${email.toLowerCase()} RETURNING user_id`;
      if (userRows.length === 0) { res.status(404).json({ error: 'No account found for this email.' }); return; }
      await sql`DELETE FROM password_reset_otps WHERE email = ${email.toLowerCase()}`;

      const token = newToken();
      const expires = sessionExpiry();
      await sql`INSERT INTO auth_sessions (token, user_id, expires_at) VALUES (${token}, ${userRows[0].user_id}, ${expires.toISOString()})`;
      setSessionCookie(res, token);
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[api/auth]', err);
      res.status(500).json({ error: 'Something went wrong resetting your password.' });
    }
    return;
  }

  res.status(400).json({ error: 'Unknown action' });
}
