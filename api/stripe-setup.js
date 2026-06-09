// Creates a Stripe SetupIntent session so a customer can save their card on file
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const provided = req.headers['x-admin-password'];
  if (!provided || provided !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { customer_id, customer_name, customer_email, stripe_customer_id } = req.body;
  if (!customer_id || !customer_name) {
    return res.status(400).json({ error: 'Missing customer info' });
  }

  const origin = 'https://scoopngoarizona.com';
  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const BASE = 'https://emvqtgsjdbyaionxguhq.supabase.co/rest/v1';
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    let stripeCustomerId = stripe_customer_id;

    // Create Stripe customer if we don't have one yet
    if (!stripeCustomerId) {
      const custParams = new URLSearchParams({ name: customer_name });
      if (customer_email) custParams.set('email', customer_email);
      custParams.set('metadata[supabase_id]', customer_id);

      const custRes = await fetch('https://api.stripe.com/v1/customers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${STRIPE_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: custParams.toString(),
      });
      const custData = await custRes.json();
      if (!custRes.ok) throw new Error(custData.error?.message || 'Failed to create Stripe customer');
      stripeCustomerId = custData.id;

      // Save stripe_customer_id back to Supabase
      await fetch(`${BASE}/customers?id=eq.${customer_id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPA_KEY,
          'Authorization': `Bearer ${SUPA_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ stripe_customer_id: stripeCustomerId }),
      });
    }

    // Create Stripe Checkout session in setup mode
    const params = new URLSearchParams({
      'customer': stripeCustomerId,
      'mode': 'setup',
      'payment_method_types[0]': 'card',
      'success_url': `${origin}/payment-success?type=card_saved&name=${encodeURIComponent(customer_name)}`,
      'cancel_url': `${origin}/admin`,
      'metadata[customer_id]': customer_id,
      'metadata[customer_name]': customer_name,
      'metadata[setup_for]': 'card_on_file',
    });

    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || 'Stripe error');

    return res.status(200).json({ url: data.url, stripe_customer_id: stripeCustomerId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
