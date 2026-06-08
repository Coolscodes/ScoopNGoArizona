// Creates a Stripe Checkout payment link for an invoice
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { invoice_id, customer_name, amount, description } = req.body;
  if (!amount || !customer_name) return res.status(400).json({ error: 'Missing required fields' });

  const origin = 'https://scoopngoarizona.com';

  const params = new URLSearchParams({
    'payment_method_types[0]': 'card',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': `Scoop N Go Arizona — ${description || 'Invoice'}`,
    'line_items[0][price_data][product_data][description]': `Payment for ${customer_name}`,
    'line_items[0][price_data][unit_amount]': String(Math.round(parseFloat(amount) * 100)),
    'line_items[0][quantity]': '1',
    'mode': 'payment',
    'success_url': `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    'cancel_url': `${origin}/admin`,
    'customer_email': req.body.customer_email || '',
    'metadata[invoice_id]': invoice_id || '',
    'metadata[customer_name]': customer_name,
  });

  // Remove empty customer_email if not provided
  if (!req.body.customer_email) params.delete('customer_email');

  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || 'Stripe error');
    return res.status(200).json({ url: data.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
