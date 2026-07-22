import bcrypt from 'bcryptjs';
import { db } from '../lib/db.js';
import { getUserFromRequest, clearSessionCookie } from '../lib/auth.js';

// Consolidates the old profile/update.js, password.js, delete.js, and
// login-history.js into one function, to stay well under Vercel
// Hobby's 12-serverless-function limit.
//   GET    /api/profile?action=history
//   PUT    /api/profile  { action:'update', ... }        (action defaults to 'update')
//   PUT    /api/profile  { action:'password', ... }
//   DELETE /api/profile

export default async function handler(req, res) {
  const sql = db();
  const user = await getUserFromRequest(req, sql);
  if (!user) { res.status(401).json({ error: 'Not logged in' }); return; }

  if (req.method === 'GET' && req.query.action === 'history') {
    try {
      const rows = await sql`
        SELECT logged_in_at FROM login_history
        WHERE user_id = ${user.user_id} ORDER BY logged_in_at DESC LIMIT 10
      `;
      res.status(200).json({ history: rows.map((r) => r.logged_in_at) });
    } catch (err) {
      console.error('[api/profile]', err);
      res.status(500).json({ error: 'Database error' });
    }
    return;
  }

  if (req.method === 'PUT') {
    const { action } = req.body || {};

    if (action === 'password') {
      const { currentPassword, newPassword } = req.body || {};
      if (!newPassword || newPassword.length < 8) {
        res.status(400).json({ error: 'New password must contain at least 8 characters.' }); return;
      }
      try {
        const rows = await sql`SELECT password_hash FROM users WHERE user_id = ${user.user_id}`;
        const ok = await bcrypt.compare(currentPassword || '', rows[0].password_hash);
        if (!ok) { res.status(401).json({ error: 'Current password is incorrect.' }); return; }
        const hash = await bcrypt.hash(newPassword, 10);
        await sql`UPDATE users SET password_hash = ${hash} WHERE user_id = ${user.user_id}`;
        res.status(200).json({ ok: true });
      } catch (err) {
        console.error('[api/profile]', err);
        res.status(500).json({ error: 'Could not change password.' });
      }
      return;
    }

    // default: profile update
    const { fullName, accommodationType, occupants, monthlyBudget } = req.body || {};
    try {
      const rows = await sql`
        UPDATE users SET
          full_name = COALESCE(${fullName || null}, full_name),
          accommodation_type = COALESCE(${accommodationType || null}, accommodation_type),
          occupants = COALESCE(${occupants || null}, occupants),
          monthly_budget = COALESCE(${monthlyBudget || null}, monthly_budget)
        WHERE user_id = ${user.user_id}
        RETURNING user_id, email, full_name, accommodation_type, occupants, monthly_budget, green_score, created_at
      `;
      res.status(200).json({ user: rows[0] });
    } catch (err) {
      console.error('[api/profile]', err);
      res.status(500).json({ error: 'Could not update profile.' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      await sql`DELETE FROM users WHERE user_id = ${user.user_id}`; // cascades to sessions, login history
      clearSessionCookie(res);
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[api/profile]', err);
      res.status(500).json({ error: 'Could not delete account.' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
