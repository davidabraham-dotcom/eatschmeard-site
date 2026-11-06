// Password-protected database access for the admin dashboard only.
// The password is the ADMIN_PASSWORD environment variable; it is never in any page.
const { getDb, json, parseBody, safeEqual } = require('../lib/common');

const TABLES = ['orders', 'order_items', 'products', 'pickup_slots', 'pickup_config', 'admin_settings', 'wholesale_inquiries'];
const METHODS = ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'like', 'ilike',
  'order', 'limit', 'range', 'single', 'maybeSingle', 'not', 'or', 'match', 'contains', 'filter'];
const WRITES = ['insert', 'update', 'upsert'];
const SECRET_COL = 'admin_password_hash';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) if (k !== SECRET_COL) o[k] = strip(v[k]); return o; }
  return v;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const expected = process.env.ADMIN_PASSWORD || process.env.Password;
  if (!expected) return json(503, { error: 'Admin password is not configured yet.', status: 503 });
  const given = event.headers['x-admin-password'] || '';
  if (!safeEqual(given, expected)) { await sleep(600); return json(401, { error: 'Invalid password', status: 401 }); }

  const b = parseBody(event);
  const chain = b && b.chain;
  if (!Array.isArray(chain) || chain.length < 1 || chain.length > 25) return json(400, { error: 'Invalid request.' });
  if (chain[0].m !== 'from' || !TABLES.includes(chain[0].a && chain[0].a[0])) return json(400, { error: 'Table not allowed.' });

  try {
    let q = getDb().from(chain[0].a[0]);
    for (const step of chain.slice(1)) {
      if (!METHODS.includes(step.m) || !Array.isArray(step.a)) return json(400, { error: 'Method not allowed.' });
      if (WRITES.includes(step.m) && JSON.stringify(step.a).includes(SECRET_COL)) return json(400, { error: 'That field is managed in Netlify.' });
      q = q[step.m](...step.a);
    }
    const res = await q;
    return json(200, {
      data: strip(res.data === undefined ? null : res.data),
      count: res.count == null ? null : res.count,
      error: res.error ? { message: res.error.message, code: res.error.code, details: res.error.details, hint: res.error.hint } : null,
    });
  } catch (e) {
    console.error('admin-db error:', e.message);
    return json(500, { error: 'Request failed.' });
  }
};
