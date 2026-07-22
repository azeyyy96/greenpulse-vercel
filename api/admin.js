import { db } from '../lib/db.js';
import { getUserFromRequest } from '../lib/auth.js';

// Single consolidated admin endpoint (keeps the function count low --
// see the note in README about Vercel Hobby's 12-function limit).
// Every action requires a logged-in session AND is_admin = true.
//   GET  /api/admin?action=listBrands
//   GET  /api/admin?action=listModels[&type=X][&brandId=Y]
//   GET  /api/admin?action=getTariff
//   POST /api/admin  { action: 'addBrand'|'renameBrand'|'deleteBrand'|
//                       'addModel'|'updateModel'|'deleteModel'|
//                       'updateTariff'|'addEeiBand'|'updateEeiBand'|'deleteEeiBand', ... }

async function requireAdmin(req, sql) {
  const user = await getUserFromRequest(req, sql);
  if (!user) return { error: 'Not logged in', status: 401 };
  if (!user.is_admin) return { error: 'Admin access required', status: 403 };
  return { user };
}

export default async function handler(req, res) {
  const sql = db();
  const auth = await requireAdmin(req, sql);
  if (auth.error) { res.status(auth.status).json({ error: auth.error }); return; }

  try {
    // ============================================================ GET
    if (req.method === 'GET') {
      const { action } = req.query;

      if (action === 'listBrands') {
        const rows = await sql`
          SELECT b.brand_id, b.brand_name, COUNT(m.model_id)::int AS model_count
          FROM brands b
          LEFT JOIN appliance_models m ON m.brand_id = b.brand_id
          GROUP BY b.brand_id, b.brand_name
          ORDER BY b.brand_name ASC
        `;
        res.status(200).json({ brands: rows });
        return;
      }

      if (action === 'listModels') {
        const { type, brandId } = req.query;
        let rows;
        if (type && brandId) {
          rows = await sql`
            SELECT m.model_id, m.brand_id, b.brand_name, m.appliance_type, m.model_name, m.wattage_w
            FROM appliance_models m JOIN brands b ON b.brand_id = m.brand_id
            WHERE m.appliance_type = ${type} AND m.brand_id = ${Number(brandId)}
            ORDER BY m.model_name ASC`;
        } else if (type) {
          rows = await sql`
            SELECT m.model_id, m.brand_id, b.brand_name, m.appliance_type, m.model_name, m.wattage_w
            FROM appliance_models m JOIN brands b ON b.brand_id = m.brand_id
            WHERE m.appliance_type = ${type}
            ORDER BY b.brand_name ASC, m.model_name ASC`;
        } else {
          rows = await sql`
            SELECT m.model_id, m.brand_id, b.brand_name, m.appliance_type, m.model_name, m.wattage_w
            FROM appliance_models m JOIN brands b ON b.brand_id = m.brand_id
            ORDER BY m.appliance_type ASC, b.brand_name ASC, m.model_name ASC`;
        }
        res.status(200).json({ models: rows });
        return;
      }

      if (action === 'getTariff') {
        const settings = await sql`SELECT * FROM tariff_settings WHERE id = 1`;
        const bands = await sql`SELECT * FROM eei_bands ORDER BY sort_order ASC`;
        res.status(200).json({ settings: settings[0], eeiBands: bands });
        return;
      }

      res.status(400).json({ error: 'Unknown action' });
      return;
    }

    // ============================================================ POST
    if (req.method === 'POST') {
      const { action } = req.body || {};

      // ---- Brands ----
      if (action === 'addBrand') {
        const { name } = req.body || {};
        if (!name || !name.trim()) { res.status(400).json({ error: 'Brand name required' }); return; }
        const rows = await sql`INSERT INTO brands (brand_name) VALUES (${name.trim()}) RETURNING brand_id, brand_name`;
        res.status(200).json({ brand: rows[0] });
        return;
      }

      if (action === 'renameBrand') {
        const { brandId, name } = req.body || {};
        if (!brandId || !name || !name.trim()) { res.status(400).json({ error: 'brandId and name required' }); return; }
        const rows = await sql`UPDATE brands SET brand_name = ${name.trim()} WHERE brand_id = ${brandId} RETURNING brand_id, brand_name`;
        if (rows.length === 0) { res.status(404).json({ error: 'Brand not found' }); return; }
        res.status(200).json({ brand: rows[0] });
        return;
      }

      if (action === 'deleteBrand') {
        const { brandId } = req.body || {};
        if (!brandId) { res.status(400).json({ error: 'brandId required' }); return; }
        // ON DELETE CASCADE on appliance_models.brand_id removes its models too --
        // the client confirms this with the model count before calling.
        const rows = await sql`DELETE FROM brands WHERE brand_id = ${brandId} RETURNING brand_id`;
        if (rows.length === 0) { res.status(404).json({ error: 'Brand not found' }); return; }
        res.status(200).json({ ok: true });
        return;
      }

      // ---- Models ----
      if (action === 'addModel') {
        const { brandId, type, model, watt } = req.body || {};
        if (!brandId || !type || !model || !watt) { res.status(400).json({ error: 'brandId, type, model and watt are required' }); return; }
        const rows = await sql`
          INSERT INTO appliance_models (brand_id, appliance_type, model_name, wattage_w)
          VALUES (${brandId}, ${type}, ${model.trim()}, ${watt})
          RETURNING model_id, brand_id, appliance_type, model_name, wattage_w`;
        res.status(200).json({ model: rows[0] });
        return;
      }

      if (action === 'updateModel') {
        const { modelId, brandId, type, model, watt } = req.body || {};
        if (!modelId) { res.status(400).json({ error: 'modelId required' }); return; }
        const rows = await sql`
          UPDATE appliance_models SET
            brand_id = ${brandId}, appliance_type = ${type}, model_name = ${model.trim()}, wattage_w = ${watt}
          WHERE model_id = ${modelId}
          RETURNING model_id, brand_id, appliance_type, model_name, wattage_w`;
        if (rows.length === 0) { res.status(404).json({ error: 'Model not found' }); return; }
        res.status(200).json({ model: rows[0] });
        return;
      }

      if (action === 'deleteModel') {
        const { modelId } = req.body || {};
        if (!modelId) { res.status(400).json({ error: 'modelId required' }); return; }
        const rows = await sql`DELETE FROM appliance_models WHERE model_id = ${modelId} RETURNING model_id`;
        if (rows.length === 0) { res.status(404).json({ error: 'Model not found' }); return; }
        res.status(200).json({ ok: true });
        return;
      }

      // ---- Tariff ----
      if (action === 'updateTariff') {
        const { rateLowSen, rateHighSen, rateThresholdKwh, retailChargeRm, retailWaiverKwh, minimumBillRm } = req.body || {};
        const rows = await sql`
          UPDATE tariff_settings SET
            rate_low_sen = ${rateLowSen}, rate_high_sen = ${rateHighSen},
            rate_threshold_kwh = ${rateThresholdKwh}, retail_charge_rm = ${retailChargeRm},
            retail_waiver_kwh = ${retailWaiverKwh}, minimum_bill_rm = ${minimumBillRm},
            updated_at = NOW()
          WHERE id = 1
          RETURNING *`;
        res.status(200).json({ settings: rows[0] });
        return;
      }

      if (action === 'addEeiBand') {
        const { minKwh, maxKwh, rebateSen, sortOrder } = req.body || {};
        const rows = await sql`
          INSERT INTO eei_bands (min_kwh, max_kwh, rebate_sen, sort_order)
          VALUES (${minKwh}, ${maxKwh}, ${rebateSen}, ${sortOrder || 999})
          RETURNING *`;
        res.status(200).json({ band: rows[0] });
        return;
      }

      if (action === 'updateEeiBand') {
        const { bandId, minKwh, maxKwh, rebateSen, sortOrder } = req.body || {};
        if (!bandId) { res.status(400).json({ error: 'bandId required' }); return; }
        const rows = await sql`
          UPDATE eei_bands SET min_kwh = ${minKwh}, max_kwh = ${maxKwh}, rebate_sen = ${rebateSen}, sort_order = ${sortOrder}
          WHERE id = ${bandId}
          RETURNING *`;
        if (rows.length === 0) { res.status(404).json({ error: 'Band not found' }); return; }
        res.status(200).json({ band: rows[0] });
        return;
      }

      if (action === 'deleteEeiBand') {
        const { bandId } = req.body || {};
        if (!bandId) { res.status(400).json({ error: 'bandId required' }); return; }
        const rows = await sql`DELETE FROM eei_bands WHERE id = ${bandId} RETURNING id`;
        if (rows.length === 0) { res.status(404).json({ error: 'Band not found' }); return; }
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: 'Unknown action' });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[api/admin]', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}
