// Creates a Stripe subscription or one-time checkout session
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { plan, dogs, deodorizer, haul_away, amount_cents, label } = req.body;
  const origin = 'https://scoopngoarizona.com';

  // Recurring cadence per plan.
  const plans = {
    weekly:   { interval: 'week',  interval_count: 1, cadence: 'every week' },
    biweekly: { interval: 'week',  interval_count: 2, cadence: 'every 2 weeks' },
    monthly:  { interval: 'month', interval_count: 1, cadence: 'every month' },
  };

  // New-client special (WEEKLY & BI-WEEKLY only): FREE first cleanup, then prepay a set number
  // of paid visits up front, then regular per-visit billing resumes. The trial period covers the
  // free + prepaid service window so Stripe does not double-charge during it.
  //   weekly:   free wk1 + 4 paid weeks = 5 weeks of service, per-visit billing resumes wk6 (day 35)
  //   biweekly: free + 3 paid bi-weekly visits = 4 visits, per-visit billing resumes visit 5 (day 56)
  const offers = {
    weekly:   { prepaidVisits: 4, trialDays: 35 },
    biweekly: { prepaidVisits: 3, trialDays: 56 },
  };

  const selected = plans[plan];
  if (!selected || !amount_cents) return res.status(400).json({ error: 'Invalid plan or amount' });

  const offer = offers[plan] || null;

  const planLabel   = { weekly: 'Weekly', biweekly: 'Bi-Weekly', monthly: 'Monthly' }[plan];
  const productName = `Scoop N Go Arizona | ${planLabel} Dog Waste Removal`;

  const dogLine  = `${dogs} dog${dogs > 1 ? 's' : ''}`;
  const deodLine = deodorizer ? ' + Deodorizer Treatment' : '';
  const haulLine = haul_away ? ' + Haul-Away' : '';
  const perVisit = `$${(amount_cents / 100).toFixed(0)}`;

  const summaryLine = offer
    ? `${dogLine}${deodLine}${haulLine} · ${perVisit}/visit billed ${selected.cadence} after your prepaid intro`
    : `${dogLine}${deodLine}${haulLine} · ${perVisit} billed ${selected.cadence}`;

  const description = [
    summaryLine,
    ...(offer ? ['🎉 FIRST CLEANUP FREE, then prepay your intro visits up front'] : []),
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
    'line_items[0][price_data][unit_amount]': String(amount_cents),
    'line_items[0][quantity]': '1',
    'mode': 'subscription',
    'success_url': `${origin}/payment-success?type=subscription`,
    'cancel_url': `${origin}/#pricing`,
    'metadata[plan]': plan,
    'metadata[per_visit_cents]': String(amount_cents),
    'metadata[dogs]': String(dogs),
    'metadata[deodorizer]': String(deodorizer),
    'metadata[haul_away]': String(haul_away || false),
    'phone_number_collection[enabled]': 'true',
  });

  // Attach the intro offer: one-time prepay line item + a trial so recurring per-visit billing
  // pauses until the prepaid window ends.
  if (offer) {
    const prepayCents = amount_cents * offer.prepaidVisits;
    const visitWord = offer.prepaidVisits === 1 ? 'visit' : 'visits';
    params.set('line_items[1][price_data][currency]', 'usd');
    params.set('line_items[1][price_data][product_data][name]', `Prepaid Intro · ${offer.prepaidVisits} ${visitWord} + FREE First Cleanup`);
    params.set('line_items[1][price_data][product_data][description]', `One-time charge today for your first ${offer.prepaidVisits} paid ${visitWord}, plus a FREE first cleanup no matter how big or small the job. Regular per-visit billing starts after your prepaid visits are used.`);
    params.set('line_items[1][price_data][unit_amount]', String(prepayCents));
    params.set('line_items[1][quantity]', '1');
    params.set('subscription_data[trial_period_days]', String(offer.trialDays));
    params.set('metadata[prepay_cents]', String(prepayCents));
    params.set('metadata[prepaid_visits]', String(offer.prepaidVisits));
    params.set('metadata[free_first_cleanup]', 'true');
  }

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
