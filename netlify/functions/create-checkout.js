// Netlify Function: Create Stripe Checkout Session
// This runs server-side so the Stripe secret key stays secure

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { items, customer_email, customer_name, order_id, pickup_info } = JSON.parse(event.body);

    if (!items || !items.length || !customer_email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Build line items for Stripe
    const line_items = items.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
          description: item.description || 'Schmear\'d Cream Cheese',
        },
        unit_amount: Math.round(item.price * 100), // Stripe uses cents
      },
      quantity: item.quantity,
    }));

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      customer_email,
      success_url: `${process.env.URL || 'https://eatschmeard.com'}/order.html?success=true&session_id={CHECKOUT_SESSION_ID}&order_id=${order_id}`,
      cancel_url: `${process.env.URL || 'https://eatschmeard.com'}/order.html?cancelled=true&order_id=${order_id}`,
      metadata: {
        order_id: String(order_id),
        customer_name,
        pickup_info: pickup_info || '',
      },
      payment_intent_data: {
        receipt_email: customer_email,
      },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ sessionId: session.id, url: session.url }),
    };
  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
