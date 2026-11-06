const { getDb, json, parseBody } = require('../lib/common');
const EMAIL = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const b = parseBody(event);
  if (!b) return json(400, { error: 'Invalid request.' });
  if (b.website) return json(200, { ok: true }); // honeypot: silently drop bots
  const f = k => String(b[k] == null ? '' : b[k]).trim();
  const row = {
    store_name: f('store_name').slice(0, 150), contact_name: f('contact_name').slice(0, 100), email: f('email').slice(0, 200),
    phone: f('phone').slice(0, 30) || null, store_address: f('store_address').slice(0, 250) || null, message: f('message').slice(0, 2000) || null,
  };
  if (!row.store_name || !row.contact_name || !EMAIL.test(row.email)) return json(400, { error: 'Please fill in the required fields.' });
  try {
    const { error } = await getDb().from('wholesale_inquiries').insert({ ...row, created_at: new Date().toISOString() });
    if (error) throw error;
    return json(200, { ok: true });
  } catch (e) {
    console.error('wholesale-inquiry error:', e.message);
    return json(500, { error: 'Could not submit. Please try again.' });
  }
};
