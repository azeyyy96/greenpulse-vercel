import { db } from '../lib/db.js';
import { getUserFromRequest } from '../lib/auth.js';

// Consolidates the old appliances.js + appliances/[id].js into one
// function (no dynamic route), to stay well under Vercel Hobby's
// 12-serverless-function limit. The id moves from the URL path into
// the request body (PUT) or a query param (DELETE) instead.
//   GET    /api/appliances                -> list
//   POST   /api/appliances                 -> create
//   PUT    /api/appliances  { id, ... }      -> update (ownership-checked)
//   DELETE /api/appliances?id=X               -> delete (ownership-checked)

function toClientShape(row) {
  return {
    id: String(row.id),
    brand: row.brand,
    type: row.appliance_type,
    model: row.model,
    watt: Number(row.watt),
    hours: Number(row.hours),
    usageTime: row.usage_time,
  };
}

export default async function handler(req, res) {
  const sql = db();
  const user = await getUserFromRequest(req, sql);
  if (!user) { res.status(401).json({ error: 'Not logged in' }); return; }

  if (req.method === 'GET') {
    const rows = await sql`SELECT * FROM user_appliances WHERE user_id = ${user.user_id} ORDER BY created_at ASC`;
    res.status(200).json({ appliances: rows.map(toClientShape) });
    return;
  }

  if (req.method === 'POST') {
    const { brand, type, model, watt, hours, usageTime } = req.body || {};
    if (!brand || !type || !watt || !hours) { res.status(400).json({ error: 'Missing required fields' }); return; }
    const rows = await sql`
      INSERT INTO user_appliances (user_id, brand, appliance_type, model, watt, hours, usage_time)
      VALUES (${user.user_id}, ${brand}, ${type}, ${model || null}, ${watt}, ${hours}, ${usageTime || 'day'})
      RETURNING *
    `;
    res.status(200).json({ appliance: toClientShape(rows[0]) });
    return;
  }

  if (req.method === 'PUT') {
    const { id, brand, type, model, watt, hours, usageTime } = req.body || {};
    const applianceId = parseInt(id, 10);
    if (!applianceId) { res.status(400).json({ error: 'Invalid id' }); return; }
    const rows = await sql`
      UPDATE user_appliances SET
        brand = ${brand}, appliance_type = ${type}, model = ${model || null},
        watt = ${watt}, hours = ${hours}, usage_time = ${usageTime || 'day'}
      WHERE id = ${applianceId} AND user_id = ${user.user_id}
      RETURNING *
    `;
    if (rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
    res.status(200).json({ appliance: toClientShape(rows[0]) });
    return;
  }

  if (req.method === 'DELETE') {
    const applianceId = parseInt(req.query.id, 10);
    if (!applianceId) { res.status(400).json({ error: 'Invalid id' }); return; }
    await sql`DELETE FROM usage_sessions WHERE appliance_id = ${applianceId} AND user_id = ${user.user_id}`;
    const rows = await sql`DELETE FROM user_appliances WHERE id = ${applianceId} AND user_id = ${user.user_id} RETURNING id`;
    if (rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
