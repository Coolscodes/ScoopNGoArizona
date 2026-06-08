// Creates a Stripe subscription checkout session
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { plan } = req.body; // 'weekly' | 'biweekly'
  const origin = 'https://scoopngoarizona.com';

  const plans = {
    weekly:   { name: 'Weekly Dog Waste Removal', amount: 2000, interval: 'week', interval_count: 1 },
    biweekly: { name: 'Bi-Weekly Dog Waste Removal', amount: 3000, interval: 'week', interval_count: 2 },
  };

  const selected = plans[plan];
  if (!selected) return res.status(400).json({ error: 'Invalid plan' });

  const params = new URLSearchParams({
    'payment_method_types[0]': 'card',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': `Scoop N Go Arizona — ${selected.name}`,
    'line_items[0][price_data][product_data][description]': '1 dog. Additional dogs +$5/visit.',
    'line_items[0][price_data][recurring][interval]': selected.interval,
    'line_items[0][price_data][recurring][interval_count]': String(selected.interval_count),
    'line_items[0][price_data][unit_amount]': String(selected.amount),
    'line_items[0][quantity]': '1',
    'mode': 'subscription',
    'success_url': `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}&type=subscription`,
    'cancel_url': `${origin}/#pricing`,
    'metadata[plan]': plan,
  });

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
