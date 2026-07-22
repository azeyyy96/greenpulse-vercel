import { db } from '../lib/db.js';
import { getUserFromRequest } from '../lib/auth.js';

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return names[m - 1] + ' ' + y;
}

export default async function handler(req, res) {
  const sql = db();
  const user = await getUserFromRequest(req, sql);
  if (!user) {
    res.status(401).json({ error: 'Not logged in' });
    return;
  }

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT month_key, entries FROM monthly_usage_log
      WHERE user_id = ${user.user_id} ORDER BY month_key ASC
    `;
    res.status(200).json({
      history: rows.map((r) => ({ month: r.month_key, label: monthLabel(r.month_key), entries: r.entries })),
    });
    return;
  }

  if (req.method === 'POST') {
    const { month, entries } = req.body || {};
    if (!month || !entries) {
      res.status(400).json({ error: 'month and entries required' });
      return;
    }
    await sql`
      INSERT INTO monthly_usage_log (user_id, month_key, entries)
      VALUES (${user.user_id}, ${month}, ${JSON.stringify(entries)})
      ON CONFLICT (user_id, month_key) DO UPDATE SET entries = EXCLUDED.entries
    `;
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
