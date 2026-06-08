// Creates a Stripe Checkout session for a tip
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { amount } = req.body; // in dollars
  const cents = Math.round(parseFloat(amount) * 100);
  if (!cents || cents < 100) return res.status(400).json({ error: 'Minimum tip is $1' });

  const origin = 'https://scoopngoarizona.com';

  const params = new URLSearchParams({
    'payment_method_types[0]': 'card',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': '🐾 Tip for your Scoop N Go Technician',
    'line_items[0][price_data][product_data][description]': 'Thank you so much — your generosity means the world to our team!\n100% of your tip goes directly to your technician.',
    'line_items[0][price_data][product_data][images][0]': 'https://scoopngoarizona.com/Scoopngologo.png',
    'line_items[0][price_data][unit_amount]': String(cents),
    'line_items[0][quantity]': '1',
    'mode': 'payment',
    'success_url': `${origin}/payment-success?type=tip`,
    'cancel_url': `${origin}/#tip`,
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
