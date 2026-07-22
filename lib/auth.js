import crypto from 'crypto';

const COOKIE_NAME = 'gp_session';
const SESSION_DAYS = 30;

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

export function setSessionCookie(res, token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
}

export function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function sessionExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

export async function getUserFromRequest(req, sql) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const rows = await sql`
    SELECT u.user_id, u.email, u.full_name, u.accommodation_type, u.occupants,
           u.monthly_budget, u.green_score, u.created_at, u.is_admin
    FROM auth_sessions s
    JOIN users u ON u.user_id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > NOW()
  `;
  return rows[0] || null;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
