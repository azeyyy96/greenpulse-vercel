import { db } from '../lib/db.js';

// Consolidates the old types.js / brands.js / models.js into one function
// to stay well under Vercel Hobby's 12-serverless-function limit.
//   GET /api/catalog?resource=types
//   GET /api/catalog?resource=brands&type=X
//   GET /api/catalog?resource=models&type=X&brand_id=Y

export default async function handler(req, res) {
  const sql = db();
  const { resource, type, brand_id } = req.query;

  try {
    if (resource === 'types') {
      const result = await sql`SELECT DISTINCT appliance_type FROM appliance_models ORDER BY appliance_type ASC`;
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
      res.status(200).json(result.map((r) => r.appliance_type));
      return;
    }

    if (resource === 'brands') {
      let result;
      if (type) {
        result = await sql`
          SELECT DISTINCT b.brand_id, b.brand_name
          FROM brands b
          JOIN appliance_models m ON m.brand_id = b.brand_id
          WHERE m.appliance_type = ${type}
          ORDER BY b.brand_name ASC`;
      } else {
        result = await sql`SELECT brand_id, brand_name FROM brands ORDER BY brand_name ASC`;
      }
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
      res.status(200).json(result);
      return;
    }

    if (resource === 'models') {
      if (!type || !brand_id) {
        res.status(400).json({ error: 'type and brand_id are required' });
        return;
      }
      const result = await sql`
        SELECT model_id, model_name, wattage_w
        FROM appliance_models
        WHERE appliance_type = ${type} AND brand_id = ${Number(brand_id)}
        ORDER BY model_name ASC`;
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
      res.status(200).json(result);
      return;
    }

    if (resource === 'tariff') {
      const settings = await sql`SELECT * FROM tariff_settings WHERE id = 1`;
      const bands = await sql`SELECT min_kwh, max_kwh, rebate_sen FROM eei_bands ORDER BY sort_order ASC`;
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
      res.status(200).json({ settings: settings[0] || null, eeiBands: bands });
      return;
    }

    res.status(400).json({ error: 'Unknown or missing resource parameter' });
  } catch (err) {
    console.error('[api/catalog]', err);
    res.status(500).json({ error: 'Database error' });
  }
}
