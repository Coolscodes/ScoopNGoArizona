// Creates a Stripe subscription or one-time checkout session
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { plan, dogs, deodorizer, amount_cents, label } = req.body;
  const origin = 'https://scoopngoarizona.com';

  const intervals = {
    weekly:   { interval: 'week',  interval_count: 1 },
    biweekly: { interval: 'week',  interval_count: 2 },
    monthly:  { interval: 'month', interval_count: 1 },
  };

  const selected = intervals[plan];
  if (!selected || !amount_cents) return res.status(400).json({ error: 'Invalid plan or amount' });

  const planLabel   = { weekly: 'Weekly', biweekly: 'Bi-Weekly', monthly: 'Monthly' }[plan];
  const intervalLabel = { weekly: 'every week', biweekly: 'every 2 weeks', monthly: 'every month' }[plan];
  const productName = `Scoop N Go Arizona — ${planLabel} Dog Waste Removal`;

  const dogLine     = `${dogs} dog${dogs > 1 ? 's' : ''}`;
  const deodLine    = deodorizer ? ' + Deodorizer Treatment' : '';
  const description = [
    `${dogLine}${deodLine} · Billed ${intervalLabel}`,
    '✓ Full yard scoop & waste removal',
    '✓ Gate closed & secured after every visit',
    '✓ Service notification text when complete',
    '✓ Gate photo sent after each visit',
    deodorizer ? '✓ Pet-safe deodorizer applied to yard' : '✓ 100% satisfaction guarantee',
    '✓ No contracts — cancel anytime',
  ].join('\n');

  const params = new URLSearchParams({
    'payment_method_types[0]': 'card',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': productName,
    'line_items[0][price_data][product_data][description]': description,
    'line_items[0][price_data][product_data][images][0]': 'https://scoopngoarizona.com/Scoopngologo.png',
    'line_items[0][price_data][recurring][interval]': selected.interval,
    'line_items[0][price_data][recurring][interval_count]': String(selected.interval_count),
    'line_items[0][price_data][unit_amount]': String(amount_cents),
    'line_items[0][quantity]': '1',
    'mode': 'subscription',
    'success_url': `${origin}/payment-success?type=subscription`,
    'cancel_url': `${origin}/#pricing`,
    'metadata[plan]': plan,
    'metadata[dogs]': String(dogs),
    'metadata[deodorizer]': String(deodorizer),
    'phone_number_collection[enabled]': 'true',
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
