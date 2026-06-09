// Stripe webhook — handles payment completion events
export const config = { api: { bodyParser: false } };

const SUPABASE_URL = 'https://emvqtgsjdbyaionxguhq.supabase.co';

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function supabase(path, method, body) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Verify Stripe signature
  if (webhookSecret) {
    try {
      const crypto = await import('crypto');
      const parts = sig.split(',').reduce((acc, part) => {
        const [k, v] = part.split('=');
        acc[k] = v;
        return acc;
      }, {});
      const payload = `${parts.t}.${rawBody}`;
      const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
      if (expected !== parts.v1) return res.status(400).json({ error: 'Invalid signature' });
    } catch {
      return res.status(400).json({ error: 'Signature verification failed' });
    }
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { invoice_id, plan, dogs, deodorizer, customer_name, customer_id } = session.metadata || {};

    // Save payment method when a card setup session completes
    if (session.mode === 'setup' && customer_id && session.setup_intent) {
      try {
        // Fetch the SetupIntent to get the payment method
        const siRes = await fetch(`https://api.stripe.com/v1/setup_intents/${session.setup_intent}`, {
          headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` },
        });
        const si = await siRes.json();
        if (si.payment_method) {
          // Set as default on the Stripe customer
          await fetch(`https://api.stripe.com/v1/customers/${session.customer}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `invoice_settings[default_payment_method]=${si.payment_method}`,
          });
          // Save payment method ID to Supabase customer record
          await supabase(`customers?id=eq.${customer_id}`, 'PATCH', {
            stripe_payment_method_id: si.payment_method,
            stripe_customer_id: session.customer,
          });
        }
      } catch (e) {
        // Non-fatal — card is still saved in Stripe
      }
    }

    // 1. Mark invoice paid (admin-generated payment links)
    if (invoice_id) {
      await supabase(`invoices?id=eq.${invoice_id}`, 'PATCH', { status: 'paid' });
    }

    // 2. Auto-create customer when someone subscribes online
    if (plan && !invoice_id) {
      const stripeCustomerId = session.customer;
      const email = session.customer_details?.email || '';
      const phone = session.customer_details?.phone || '';
      const name = session.customer_details?.name || customer_name || '';
      const [firstName, ...rest] = name.split(' ');
      const lastName = rest.join(' ');

      const planLabel = { weekly: 'Weekly', biweekly: 'Bi-Weekly', monthly: 'Monthly' }[plan] || plan;
      const dogCount = parseInt(dogs) || 1;
      const hasDeod = deodorizer === 'true';

      // Create customer record
      const custRes = await supabase('customers', 'POST', {
        first_name: firstName || 'Online',
        last_name: lastName || 'Subscriber',
        email,
        phone,
        address: '',
        city: '',
        zip: '',
        service_type: planLabel,
        status: 'active',
        stripe_customer_id: stripeCustomerId || '',
        notes: `Subscribed online via Stripe. ${dogCount} dog${dogCount > 1 ? 's' : ''}${hasDeod ? ' + deodorizer' : ''}.`,
      });

      const custData = await custRes.json();
      const customerId = Array.isArray(custData) ? custData[0]?.id : null;

      // Create dog record(s)
      if (customerId) {
        for (let i = 0; i < dogCount; i++) {
          await supabase('dogs', 'POST', {
            customer_id: customerId,
            name: dogCount === 1 ? 'Dog' : `Dog ${i + 1}`,
            breed: '',
            notes: '',
          });
        }
      }

      // Send owner notification email
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Scoop N Go Arizona <onboarding@resend.dev>',
          to: 'scoopngoarizona@gmail.com',
          reply_to: email || 'noreply@stripe.com',
          subject: `💳 New Online Subscriber: ${name || 'New Client'} (${planLabel})`,
          text: `
New subscription payment received!

Name:     ${name || 'Unknown'}
Email:    ${email || 'Not provided'}
Phone:    ${phone || 'Not provided'}
Plan:     ${planLabel}
Dogs:     ${dogCount}
Deod:     ${hasDeod ? 'Yes' : 'No'}

This client has been automatically added to your Customers tab in the admin dashboard.
Log in at https://scoopngoarizona.com/admin to schedule their first service.

Stripe Customer ID: ${stripeCustomerId || 'N/A'}
          `.trim(),
        }),
      });
    }
  }

  return res.status(200).json({ received: true });
}
