// Creates a Stripe subscription or one-time checkout session
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { plan, dogs, deodorizer, haul_away, amount_cents, label } = req.body;
  const origin = 'https://scoopngoarizona.com';

  // All recurring plans bill 4 weeks up front per cycle. First cleanup is free (new client special).
  const intervals = {
    weekly:   { interval: 'week',  interval_count: 4, visits: 4, billedLabel: 'every 4 weeks (4 visits)' },
    biweekly: { interval: 'week',  interval_count: 4, visits: 2, billedLabel: 'every 4 weeks (2 visits)' },
    monthly:  { interval: 'month', interval_count: 1, visits: 1, billedLabel: 'monthly (1 visit)' },
  };

  const selected = intervals[plan];
  if (!selected || !amount_cents) return res.status(400).json({ error: 'Invalid plan or amount' });

  const cycleAmountCents = amount_cents * selected.visits;

  const planLabel   = { weekly: 'Weekly', biweekly: 'Bi-Weekly', monthly: 'Monthly' }[plan];
  const productName = `Scoop N Go Arizona | ${planLabel} Dog Waste Removal`;

  const dogLine     = `${dogs} dog${dogs > 1 ? 's' : ''}`;
  const deodLine    = deodorizer ? ' + Deodorizer Treatment' : '';
  const haulLine    = haul_away ? ' + Haul-Away' : '';
  const description = [
    `${dogLine}${deodLine}${haulLine} · $${(amount_cents / 100).toFixed(0)}/visit · Billed $${(cycleAmountCents / 100).toFixed(0)} ${selected.billedLabel}`,
    '🎉 FIRST CLEANUP FREE, included with your prepaid first 4 weeks',
    '✓ Full yard scoop',
    haul_away ? '✓ Waste hauled off your property' : '✓ Waste double-bagged in your trash bin',
    '✓ Gate closed & secured after every visit',
    '✓ Service notification text when complete',
    '✓ Gate photo sent after each visit',
    deodorizer ? '✓ Pet-safe deodorizer applied to yard' : '✓ 100% satisfaction guarantee',
    '✓ No contracts, cancel anytime',
  ].join('\n');

  const params = new URLSearchParams({
    'payment_method_types[0]': 'card',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': productName,
    'line_items[0][price_data][product_data][description]': description,
    'line_items[0][price_data][product_data][images][0]': 'https://scoopngoarizona.com/Scoopngologo.png',
    'line_items[0][price_data][recurring][interval]': selected.interval,
    'line_items[0][price_data][recurring][interval_count]': String(selected.interval_count),
    'line_items[0][price_data][unit_amount]': String(cycleAmountCents),
    'line_items[0][quantity]': '1',
    'mode': 'subscription',
    'success_url': `${origin}/payment-success?type=subscription`,
    'cancel_url': `${origin}/#pricing`,
    'metadata[plan]': plan,
    'metadata[per_visit_cents]': String(amount_cents),
    'metadata[free_first_cleanup]': 'true',
    'metadata[dogs]': String(dogs),
    'metadata[deodorizer]': String(deodorizer),
    'metadata[haul_away]': String(haul_away || false),
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
