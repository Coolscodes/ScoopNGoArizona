// Stripe webhook — marks invoices paid in Supabase when payment completes
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Verify signature if webhook secret is set
  if (webhookSecret) {
    try {
      // Simple HMAC verification without the full Stripe SDK
      const crypto = await import('crypto');
      const [, timestampPart, , signaturePart] = sig.split(/[=,]/);
      const payload = `${timestampPart}.${rawBody}`;
      const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
      if (expected !== signaturePart) return res.status(400).json({ error: 'Invalid signature' });
    } catch {
      return res.status(400).json({ error: 'Signature verification failed' });
    }
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const invoiceId = session.metadata?.invoice_id;

    if (invoiceId) {
      await fetch(`https://emvqtgsjdbyaionxguhq.supabase.co/rest/v1/invoices?id=eq.${invoiceId}`, {
        method: 'PATCH',
        headers: {
          'apikey': process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'paid' }),
      });
    }
  }

  return res.status(200).json({ received: true });
}
