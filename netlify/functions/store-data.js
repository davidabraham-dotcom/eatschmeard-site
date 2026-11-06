// Public, read-only. Returns only the fields the storefront needs.
const { getDb, json, todayET, pick } = require('../lib/common');

const PRODUCT_KEYS = ['id', 'name', 'subtitle', 'description', 'price', 'quantity_available', 'is_active', 'sort_order'];
const SLOT_KEYS = ['id', 'pickup_date', 'start_time', 'end_time', 'location_name', 'location_address', 'current_orders', 'max_orders'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  try {
    const db = getDb();
    const [p, s, a] = await Promise.all([
      db.from('products').select('*').eq('is_active', true).order('sort_order'),
      db.from('pickup_slots').select('*').eq('is_active', true).gte('pickup_date', todayET()).order('pickup_date').order('start_time'),
      db.from('admin_settings').select('store_open, store_message').eq('id', 1).maybeSingle(),
    ]);
    if (p.error) throw p.error;
    if (s.error) throw s.error;
    return json(200, {
      products: (p.data || []).map(r => pick(r, PRODUCT_KEYS)),
      slots: (s.data || []).map(r => pick(r, SLOT_KEYS)),
      settings: (a && a.data) || { store_open: true },
    });
  } catch (e) {
    console.error('store-data error:', e.message);
    return json(500, { error: 'Unable to load the store right now.' });
  }
};
