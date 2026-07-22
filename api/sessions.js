import { db } from '../lib/db.js';
import { getUserFromRequest } from '../lib/auth.js';

// Consolidates the old sessions.js + sessions/[id].js into one function
// (no dynamic route), to stay well under Vercel Hobby's
// 12-serverless-function limit. The id moves from the URL path into
// the request body for PUT (stop) instead.
//   GET  /api/sessions                  -> list
//   POST /api/sessions  { applianceId }   -> start (ownership-checked)
//   PUT  /api/sessions  { id }              -> stop (ownership-checked)

export default async function handler(req, res) {
  const sql = db();
  const user = await getUserFromRequest(req, sql);
  if (!user) { res.status(401).json({ error: 'Not logged in' }); return; }

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, appliance_id, start_at, end_at FROM usage_sessions
      WHERE user_id = ${user.user_id} ORDER BY start_at DESC
    `;
    res.status(200).json({
      sessions: rows.map((r) => ({
        id: String(r.id),
        applianceId: String(r.appliance_id),
        start: new Date(r.start_at).getTime(),
        end: r.end_at ? new Date(r.end_at).getTime() : null,
      })),
    });
    return;
  }

  if (req.method === 'POST') {
    const { applianceId } = req.body || {};
    if (!applianceId) { res.status(400).json({ error: 'applianceId required' }); return; }
    const owned = await sql`SELECT id FROM user_appliances WHERE id = ${applianceId} AND user_id = ${user.user_id}`;
    if (owned.length === 0) { res.status(403).json({ error: 'Appliance not found' }); return; }
    const rows = await sql`
      INSERT INTO usage_sessions (user_id, appliance_id, start_at) VALUES (${user.user_id}, ${applianceId}, NOW())
      RETURNING id, start_at
    `;
    res.status(200).json({ session: { id: String(rows[0].id), start: new Date(rows[0].start_at).getTime(), end: null, applianceId } });
    return;
  }

  if (req.method === 'PUT') {
    const { id } = req.body || {};
    const sessionId = parseInt(id, 10);
    if (!sessionId) { res.status(400).json({ error: 'Invalid id' }); return; }
    const rows = await sql`
      UPDATE usage_sessions SET end_at = NOW()
      WHERE id = ${sessionId} AND user_id = ${user.user_id} AND end_at IS NULL
      RETURNING id, appliance_id, start_at, end_at
    `;
    if (rows.length === 0) { res.status(404).json({ error: 'Not found or already stopped' }); return; }
    const r = rows[0];
    res.status(200).json({
      session: { id: String(r.id), applianceId: String(r.appliance_id), start: new Date(r.start_at).getTime(), end: new Date(r.end_at).getTime() },
    });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
