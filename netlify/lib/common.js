// Shared helpers for the server-side functions. The database key lives ONLY in
// the SUPABASE_SERVICE_KEY environment variable and never reaches the browser.
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://sotesfefkeonykvlchzs.supabase.co';
let _db;

function getDb() {
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.Supabase;
  if (!key) throw new Error('Supabase key is not configured');
  if (!_db) _db = createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _db;
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  try {
    if (!event.body || event.body.length > 50000) return null;
    const b = JSON.parse(event.body);
    return b && typeof b === 'object' ? b : null;
  } catch (e) { return null; }
}

function tokenSecret() {
  const s = process.env.ORDER_TOKEN_SECRET || process.env.STRIPE_SECRET_KEY;
  if (!s) throw new Error('No order token secret configured');
  return s;
}
// Proves that whoever returns from Stripe is the person who created the order.
function orderToken(id) {
  return crypto.createHmac('sha256', tokenSecret()).update('order:' + String(id)).digest('hex').slice(0, 40);
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
function siteUrl() { return (process.env.URL || 'https://eatschmeard.com').replace(/\/$/, ''); }
function todayET() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }
function pick(obj, keys) { const o = {}; keys.forEach(k => { if (obj && k in obj) o[k] = obj[k]; }); return o; }

// Compare-and-swap adjust of a numeric column so two simultaneous orders cannot oversell.
async function adjust(db, table, id, field, delta, guard) {
  for (let i = 0; i < 6; i++) {
    const { data: row, error } = await db.from(table).select(field).eq('id', id).single();
    if (error || !row) return { ok: false, reason: 'missing' };
    const cur = Number(row[field]); const next = cur + delta;
    if (guard && !guard(next, cur)) return { ok: false, reason: 'insufficient', cur };
    const { data: upd, error: ue } = await db.from(table).update({ [field]: next }).eq('id', id).eq(field, row[field]).select(field);
    if (ue) return { ok: false, reason: 'error' };
    if (upd && upd.length === 1) return { ok: true, cur, next };
  }
  return { ok: false, reason: 'busy' };
}

module.exports = { getDb, json, parseBody, orderToken, safeEqual, siteUrl, todayET, pick, adjust };
