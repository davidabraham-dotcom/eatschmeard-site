// Creates an order. Prices, stock and pickup capacity are all decided HERE from the
// database; nothing the browser sends about price or payment status is trusted.
const Stripe = require('stripe');
const { getDb, json, parseBody, orderToken, siteUrl, todayET, adjust } = require('../lib/common');

const EMAIL = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

async function release(db, reserved, slotId) {
  for (const it of reserved) await adjust(db, 'products', it.id, 'quantity_available', it.quantity);
  if (slotId) await adjust(db, 'pickup_slots', slotId, 'current_orders', -1, n => n >= 0);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const b = parseBody(event);
  if (!b) return json(400, { error: 'Invalid request.' });

  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim();
  const phoneDigits = String(b.phone || '').replace(/\D/g, '');
  const pickupLabel = String(b.pickup_label || '').slice(0, 200);
  if (!name || name.length > 100) return json(400, { error: 'Please enter your name.' });
  if (!EMAIL.test(email) || email.length > 200) return json(400, { error: 'Please enter a valid email.' });
  if (phoneDigits.length !== 10) return json(400, { error: 'Please enter a valid 10-digit phone number.' });
  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 20) return json(400, { error: 'Your cart is empty.' });

  const merged = {};
  for (const it of b.items) {
    const id = String((it && it.id) || '').slice(0, 40);
    const qty = Number(it && it.quantity);
    if (!id || !Number.isInteger(qty) || qty < 1 || qty > 50) return json(400, { error: 'Invalid cart.' });
    merged[id] = (merged[id] || 0) + qty;
  }
  const items = Object.keys(merged).map(id => ({ id, quantity: merged[id] }));

  try {
    const db = getDb();
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    const { data: settings } = await db.from('admin_settings').select('store_open').eq('id', 1).maybeSingle();
    if (settings && settings.store_open === false) return json(403, { error: 'The store is currently closed.' });

    const { data: prods, error: pe } = await db.from('products').select('*').in('id', items.map(i => i.id)).eq('is_active', true);
    if (pe) throw pe;
    const byId = {}; (prods || []).forEach(p => { byId[p.id] = p; });
    for (const it of items) {
      if (!byId[it.id]) return json(409, { error: 'An item in your cart is no longer available.', refresh: true });
    }

    const { data: slot } = await db.from('pickup_slots').select('*').eq('id', b.slot_id).eq('is_active', true).maybeSingle();
    if (!slot || slot.pickup_date < todayET() || slot.current_orders >= slot.max_orders) {
      return json(409, { error: 'That pickup time is no longer available. Please choose another.', refresh: true });
    }

    // Reserve stock, then the pickup slot
    const reserved = [];
    for (const it of items) {
      const r = await adjust(db, 'products', it.id, 'quantity_available', -it.quantity, n => n >= 0);
      if (!r.ok) {
        await release(db, reserved, null);
        const msg = r.reason === 'insufficient'
          ? 'Sorry, only ' + Math.max(0, r.cur) + ' left of ' + byId[it.id].name + '.'
          : 'We could not reserve your items. Please try again.';
        return json(409, { error: msg, refresh: true });
      }
      reserved.push(it);
    }
    const sr = await adjust(db, 'pickup_slots', slot.id, 'current_orders', 1, n => n <= slot.max_orders);
    if (!sr.ok) {
      await release(db, reserved, null);
      return json(409, { error: 'That pickup time just filled up. Please choose another.', refresh: true });
    }

    let orderId = null;
    try {
      const lines = items.map(it => {
        const p = byId[it.id];
        return { id: it.id, name: p.name, quantity: it.quantity, unit_price: parseFloat(p.price), cents: Math.round(parseFloat(p.price) * 100) };
      });
      const totalCents = lines.reduce((s, l) => s + l.cents * l.quantity, 0);
      const total = totalCents / 100;

      const { data: order, error: oe } = await db.from('orders').insert({
        customer_name: name, customer_email: email, customer_phone: String(b.phone).slice(0, 30),
        pickup_slot_id: slot.id, total_amount: total, order_status: 'pending',
      }).select().single();
      if (oe) throw oe;
      orderId = order.id;

      const { error: ie } = await db.from('order_items').insert(lines.map(l => ({
        order_id: order.id, product_id: l.id, quantity: l.quantity, unit_price: l.unit_price,
      })));
      if (ie) throw ie;

      const base = siteUrl();
      const token = orderToken(order.id);
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lines.map(l => ({
          price_data: { currency: 'usd', product_data: { name: "Schmear'd " + l.name, description: '8oz container' }, unit_amount: l.cents },
          quantity: l.quantity,
        })),
        mode: 'payment',
        customer_email: email,
        success_url: base + '/order.html?success=true&session_id={CHECKOUT_SESSION_ID}&order_id=' + order.id + '&t=' + token,
        cancel_url: base + '/order.html?cancelled=true&order_id=' + order.id + '&t=' + token,
        expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
        metadata: { order_id: String(order.id), customer_name: name, pickup_info: pickupLabel },
        payment_intent_data: { receipt_email: email },
      });

      await db.from('orders').update({ stripe_checkout_session_id: session.id }).eq('id', order.id);

      return json(200, { url: session.url, order_id: order.id, total });
    } catch (e) {
      console.error('place-order error:', e.message);
      await release(db, reserved, slot.id);
      if (orderId) await db.from('orders').update({ order_status: 'cancelled' }).eq('id', orderId);
      return json(500, { error: 'We could not start checkout. Please try again.' });
    }
  } catch (e) {
    console.error('place-order fatal:', e.message);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};
