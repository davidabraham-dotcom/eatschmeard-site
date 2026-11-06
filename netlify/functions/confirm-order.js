// Marks an order paid ONLY after asking Stripe whether it was actually paid.
const Stripe = require('stripe');
const { getDb, json, parseBody, orderToken, safeEqual } = require('../lib/common');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const b = parseBody(event);
  const id = b ? parseInt(b.order_id, 10) : NaN;
  if (!b || !Number.isInteger(id)) return json(400, { error: 'Invalid request.' });
  try {
    if (!safeEqual(orderToken(id), String(b.t || ''))) return json(403, { error: 'Not allowed.' });
    const db = getDb();
    const { data: order } = await db.from('orders').select('id, order_status, stripe_checkout_session_id').eq('id', id).maybeSingle();
    if (!order) return json(404, { error: 'Order not found.' });
    const sid = String(b.session_id || '');
    if (!order.stripe_checkout_session_id || order.stripe_checkout_session_id !== sid) return json(400, { error: 'Session mismatch.' });

    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(sid);
    const ok = session.payment_status === 'paid' && session.metadata && String(session.metadata.order_id) === String(id);
    if (!ok) return json(402, { paid: false });

    if (order.order_status !== 'paid') await db.from('orders').update({ order_status: 'paid' }).eq('id', id);
    return json(200, { paid: true });
  } catch (e) {
    console.error('confirm-order error:', e.message);
    return json(500, { error: 'Could not verify payment.' });
  }
};
