// Creates a Stripe checkout session: recurring subscription plans or a one-time cleanup payment
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { plan, dogs, deodorizer, haul_away, amount_cents, label } = req.body;
  const origin = 'https://scoopngoarizona.com';

  // Recurring cadence per plan. One-time is a mode:payment checkout, not a subscription.
  const plans = {
    weekly:   { interval: 'week',  interval_count: 1, cadence: 'every week' },
    biweekly: { interval: 'week',  interval_count: 2, cadence: 'every 2 weeks' },
    monthly:  { interval: 'month', interval_count: 1, cadence: 'every month' },
    onetime:  null,
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

  if (!(plan in plans) || !amount_cents) return res.status(400).json({ error: 'Invalid plan or amount' });

  const selected = plans[plan];
  const offer = offers[plan] || null;
  const isOneTime = plan === 'onetime';

  const planLabel   = { weekly: 'Weekly', biweekly: 'Bi-Weekly', monthly: 'Monthly', onetime: 'One-Time' }[plan];
  const productName = `Scoop N Go Arizona | ${planLabel} Dog Waste ${isOneTime ? 'Cleanup' : 'Removal'}`;

  const dogLine  = `${dogs} dog${dogs > 1 ? 's' : ''}`;
  const deodLine = deodorizer ? ' + Deodorizer Treatment' : '';
  const haulLine = haul_away ? ' + Haul-Away' : '';
  const perVisit = `$${(amount_cents / 100).toFixed(0)}`;

  let summaryLine;
  if (isOneTime) {
    summaryLine = `${dogLine}${deodLine}${haulLine} · ${perVisit} one-time full yard cleanup`;
  } else if (offer) {
    summaryLine = `${dogLine}${deodLine}${haulLine} · ${perVisit}/visit billed ${selected.cadence} after your prepaid intro`;
  } else {
    summaryLine = `${dogLine}${deodLine}${haulLine} · ${perVisit} billed ${selected.cadence}`;
  }

  const description = [
    summaryLine,
    ...(offer ? ['🎉 FIRST CLEANUP FREE, then prepay your intro visits up front'] : []),
    '✓ Full yard scoop',
    haul_away ? '✓ Waste hauled off your property' : '✓ Waste double-bagged in your trash bin',
    '✓ Gate closed & secured after every visit',
    '✓ Service notification text when complete',
    '✓ Gate photo sent after each visit',
    deodorizer ? '✓ Pet-safe deodorizer applied to yard' : '✓ 100% satisfaction guarantee',
    ...(isOneTime ? [] : ['✓ No contracts, cancel anytime']),
  ].join('\n');

  const params = new URLSearchParams({
    'payment_method_types[0]': 'card',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': productName,
    'line_items[0][price_data][product_data][description]': description,
    'line_items[0][price_data][product_data][images][0]': 'https://scoopngoarizona.com/Scoopngologo.png',
    'line_items[0][price_data][unit_amount]': String(amount_cents),
    'line_items[0][quantity]': '1',
    'mode': isOneTime ? 'payment' : 'subscription',
    'success_url': `${origin}/payment-success?type=${isOneTime ? 'onetime' : 'subscription'}`,
    'cancel_url': `${origin}/#pricing`,
    'metadata[plan]': plan,
    'metadata[per_visit_cents]': String(amount_cents),
    'metadata[dogs]': String(dogs),
    'metadata[deodorizer]': String(deodorizer),
    'metadata[haul_away]': String(haul_away || false),
    'phone_number_collection[enabled]': 'true',
    'billing_address_collection': 'required',
  });

  // Ask every customer when they want their first cleanup; lands in the webhook + owner email.
  params.set('custom_fields[0][key]', 'first_cleanup');
  params.set('custom_fields[0][label][type]', 'custom');
  params.set('custom_fields[0][label][custom]', isOneTime ? 'When should we do your cleanup?' : 'When should we do your first cleanup?');
  params.set('custom_fields[0][type]', 'dropdown');
  params.set('custom_fields[0][dropdown][options][0][label]', 'As soon as possible');
  params.set('custom_fields[0][dropdown][options][0][value]', 'asap');
  params.set('custom_fields[0][dropdown][options][1][label]', 'Later this week');
  params.set('custom_fields[0][dropdown][options][1][value]', 'thisweek');
  params.set('custom_fields[0][dropdown][options][2][label]', 'Next week');
  params.set('custom_fields[0][dropdown][options][2][value]', 'nextweek');
  params.set('custom_fields[0][dropdown][options][3][label]', 'Flexible, text me to schedule');
  params.set('custom_fields[0][dropdown][options][3][value]', 'flexible');

  if (isOneTime) {
    // Create a Stripe customer record even in payment mode so the booking shows a
    // reusable customer in Stripe and the webhook can link it.
    params.set('customer_creation', 'always');
  } else {
    params.set('line_items[0][price_data][recurring][interval]', selected.interval);
    params.set('line_items[0][price_data][recurring][interval_count]', String(selected.interval_count));
  }

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
