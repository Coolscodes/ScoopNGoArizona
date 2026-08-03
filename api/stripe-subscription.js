// Creates a Stripe checkout session. Every plan is sold as a ONE-TIME charge for an intro
// block of visits, never a subscription, so Stripe shows a plain "pay today" page with no
// trial banner. The card is saved to the customer, so ongoing per-visit billing gets set up
// by hand in Stripe once the service day and start date are confirmed with the client.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { plan, dogs, deodorizer, haul_away, amount_cents, label } = req.body;
  const origin = 'https://scoopngoarizona.com';

  // Intro block bought up front, plus the cadence the ongoing service will run on later.
  // freeFirst is the new-client special: first cleanup free no matter the size of the job.
  //   weekly:   FREE first + 4 paid weekly visits  = 5 visits
  //   biweekly: FREE first + 3 paid bi-weekly visits = 4 visits
  //   monthly:  1 paid visit, no free cleanup
  //   onetime:  single cleanup, no ongoing service
  const intros = {
    weekly:   { paidVisits: 4, freeFirst: true,  cadence: 'every week' },
    biweekly: { paidVisits: 3, freeFirst: true,  cadence: 'every 2 weeks' },
    monthly:  { paidVisits: 1, freeFirst: false, cadence: 'every month' },
    onetime:  null,
  };

  if (!(plan in intros) || !amount_cents) return res.status(400).json({ error: 'Invalid plan or amount' });

  const intro = intros[plan];
  const isOneTime = plan === 'onetime';
  const paidVisits = intro ? intro.paidVisits : 1;
  const totalVisits = paidVisits + (intro && intro.freeFirst ? 1 : 0);

  const planLabel   = { weekly: 'Weekly', biweekly: 'Bi-Weekly', monthly: 'Monthly', onetime: 'One-Time' }[plan];
  const productName = `Scoop N Go Arizona | ${planLabel} Dog Waste ${isOneTime ? 'Cleanup' : 'Removal'}`;

  const dogLine  = `${dogs} dog${dogs > 1 ? 's' : ''}`;
  const deodLine = deodorizer ? ' + Deodorizer Treatment' : '';
  const haulLine = haul_away ? ' + Haul-Away' : '';
  const perVisit = `$${(amount_cents / 100).toFixed(0)}`;
  const visitWord = paidVisits === 1 ? 'visit' : 'visits';
  // On monthly the visit and the billing period are the same thing, so "$60/visit every month" reads badly.
  const ongoingRate = plan === 'monthly' ? `${perVisit} every month` : `${perVisit}/visit ${intro ? intro.cadence : ''}`;

  let summaryLine;
  if (isOneTime) {
    summaryLine = `${dogLine}${deodLine}${haulLine} · ${perVisit} one-time full yard cleanup`;
  } else if (intro.freeFirst) {
    summaryLine = `${dogLine}${deodLine}${haulLine} · ${totalVisits} visits: your FREE first cleanup, then ${paidVisits} ${visitWord} at ${perVisit} each`;
  } else {
    summaryLine = `${dogLine}${deodLine}${haulLine} · your first ${planLabel.toLowerCase()} visit at ${perVisit}`;
  }

  const description = [
    summaryLine,
    ...(intro && intro.freeFirst ? ['🎉 FIRST CLEANUP FREE, no matter how big or small the job'] : []),
    '✓ Full yard scoop',
    haul_away ? '✓ Waste hauled off your property' : '✓ Waste double-bagged in your trash bin',
    '✓ Gate closed & secured after every visit',
    '✓ Service notification text when complete',
    '✓ Gate photo sent after each visit',
    deodorizer ? '✓ Pet-safe deodorizer applied to yard' : '✓ 100% satisfaction guarantee',
    ...(isOneTime ? [] : [
      `✓ We text you to lock in your service day, then billing continues at ${ongoingRate}`,
      '✓ No contracts, cancel anytime',
    ]),
  ].join('\n');

  const params = new URLSearchParams({
    'payment_method_types[0]': 'card',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': productName,
    'line_items[0][price_data][product_data][description]': description,
    'line_items[0][price_data][product_data][images][0]': 'https://scoopngoarizona.com/Scoopngologo.png',
    'line_items[0][price_data][unit_amount]': String(amount_cents),
    'line_items[0][quantity]': String(paidVisits),
    'mode': 'payment',
    'success_url': `${origin}/payment-success?type=${isOneTime ? 'onetime' : 'intro'}`,
    'cancel_url': `${origin}/#pricing`,
    'metadata[plan]': plan,
    'metadata[per_visit_cents]': String(amount_cents),
    'metadata[dogs]': String(dogs),
    'metadata[deodorizer]': String(deodorizer),
    'metadata[haul_away]': String(haul_away || false),
    'metadata[paid_visits]': String(paidVisits),
    'metadata[intro_visits]': String(totalVisits),
    'metadata[free_first_cleanup]': String(!!(intro && intro.freeFirst)),
    'metadata[cadence]': intro ? intro.cadence : '',
    'phone_number_collection[enabled]': 'true',
    'billing_address_collection': 'required',
    // Create the Stripe customer at checkout so the ongoing subscription can be attached to
    // it later without re-entering anything.
    'customer_creation': 'always',
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
    params.set('custom_text[submit][message]', "We'll text you to confirm your cleanup day. No subscription, this is a single visit.");
  } else {
    // Keep the card on file so ongoing per-visit billing can start once the day is set.
    params.set('payment_intent_data[setup_future_usage]', 'off_session');
    params.set('custom_text[submit][message]',
      `Today's charge covers your intro ${visitWord}. We'll text you to confirm your service day, then keep this card on file for ongoing billing at ${ongoingRate}. No contracts, cancel anytime.`);
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
