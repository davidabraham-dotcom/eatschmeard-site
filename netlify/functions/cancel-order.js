// Cancels an unpaid order and puts its stock and pickup slot back.
const Stripe = require('stripe');
const { getDb, json, parseBody, orderToken, safeEqual, adjust } = require('../lib/common');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const b = parseBody(event);
  const id = b ? parseInt(b.order_id, 10) : NaN;
  if (!b || !Number.isInteger(id)) return json(400, { error: 'Invalid request.' });
  try {
    if (!safeEqual(orderToken(id), String(b.t || ''))) return json(403, { error: 'Not allowed.' });
    const db = getDb();
    const { data: order } = await db.from('orders').select('id, order_status, stripe_checkout_session_id, pickup_slot_id').eq('id', id).maybeSingle();
    if (!order) return json(404, { error: 'Order not found.' });
    if (order.order_status !== 'pending') return json(200, { ok: true, status: order.order_status });

    if (order.stripe_checkout_session_id) {
      const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id);
      if (session.payment_status === 'paid') {
        await db.from('orders').update({ order_status: 'paid' }).eq('id', id);
        return json(200, { ok: true, status: 'paid' });
      }
      if (session.status === 'open') { try { await stripe.checkout.sessions.expire(session.id); } catch (e) { /* already closed */ } }
    }

    // Only the request that flips pending -> cancelled gets to restore stock.
    const { data: claimed } = await db.from('orders').update({ order_status: 'cancelled' }).eq('id', id).eq('order_status', 'pending').select('id');
    if (!claimed || claimed.length !== 1) return json(200, { ok: true });

    const { data: lines } = await db.from('order_items').select('product_id, quantity').eq('order_id', id);
    for (const l of lines || []) await adjust(db, 'products', l.product_id, 'quantity_available', Number(l.quantity));
    if (order.pickup_slot_id) await adjust(db, 'pickup_slots', order.pickup_slot_id, 'current_orders', -1, n => n >= 0);
    return json(200, { ok: true, status: 'cancelled' });
  } catch (e) {
    console.error('cancel-order error:', e.message);
    return json(500, { error: 'Could not cancel.' });
  }
};
