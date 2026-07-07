async function sendFailureEmail(customerName, phone, amount, reason, weekLabel, resendKey) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Scoop N Go Arizona <onboarding@resend.dev>',
        to: 'scoopngoarizona@gmail.com',
        subject: `⚠️ Payment Failed: ${customerName}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
            <h2 style="color:#c62828;">⚠️ Payment Failed</h2>
            <p>A charge did not go through for the following client:</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
              <tr><td style="padding:8px 0;color:#555;">Client</td><td style="padding:8px 0;font-weight:bold;">${customerName}</td></tr>
              <tr><td style="padding:8px 0;color:#555;">Phone</td><td style="padding:8px 0;">${phone || 'N/A'}</td></tr>
              <tr><td style="padding:8px 0;color:#555;">Amount</td><td style="padding:8px 0;font-weight:bold;">$${(amount||0).toFixed(2)}</td></tr>
              <tr><td style="padding:8px 0;color:#555;">Week</td><td style="padding:8px 0;">${weekLabel}</td></tr>
              <tr><td style="padding:8px 0;color:#555;">Reason</td><td style="padding:8px 0;color:#c62828;">${reason}</td></tr>
            </table>
            <p>You may need to send them a new card setup link or follow up directly.</p>
            <a href="https://www.scoopngoarizona.com/admin" style="display:inline-block;background:#1b5e20;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Open Admin</a>
          </div>
        `,
      }),
    });
  } catch (e) {
    // Non-fatal, don't let email failure block the rest
  }
}

// Charge all active customers with a card on file, create paid invoices, email receipts
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const adminPass = req.headers['x-admin-password'];
  if (!adminPass || adminPass !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const STRIPE_KEY  = process.env.STRIPE_SECRET_KEY;
  const RESEND_KEY  = process.env.RESEND_API_KEY;
  const BASE        = 'https://emvqtgsjdbyaionxguhq.supabase.co/rest/v1';
  const SUPA_KEY    = process.env.SUPABASE_SERVICE_KEY;
  const STRIPE_BASE = 'https://api.stripe.com/v1';

  const supa = (path, method = 'GET', body) =>
    fetch(`${BASE}/${path}`, {
      method,
      headers: {
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  const stripe = (path, method = 'GET', params) =>
    fetch(`${STRIPE_BASE}/${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${STRIPE_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params ? new URLSearchParams(params).toString() : undefined,
    }).then(r => r.json());

  // Week label for invoice notes
  const now = new Date();
  const day = now.getDay();
  const diffToMon = (day === 0) ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = d => d.toISOString().split('T')[0];
  const fmtLabel = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const periodStart = fmt(monday);
  const periodEnd   = fmt(sunday);
  const weekLabel   = `${fmtLabel(monday)} to ${fmtLabel(sunday)}, ${monday.getFullYear()}`;

  // Accept explicit list of customer IDs from the admin panel
  const { customer_ids, amounts } = req.body || {};
  if (!Array.isArray(customer_ids) || !customer_ids.length) {
    return res.status(400).json({ error: 'No customers selected' });
  }

  // Fetch only the selected customers
  const idFilter = customer_ids.map(id => `id.eq.${id}`).join(',');
  const custRes = await supa(`customers?or=(${idFilter})&order=first_name.asc`);
  const customers = await custRes.json();

  if (!Array.isArray(customers) || !customers.length) {
    return res.status(200).json({ message: 'No customers found', week: weekLabel, results: [] });
  }

  // Only skip if already PAID this week, don't skip "sent" invoices
  const invRes = await supa(`invoices?period_start=eq.${periodStart}&status=eq.paid`);
  const existing = await invRes.json();
  const existingIds = new Set((Array.isArray(existing) ? existing : []).map(i => i.customer_id));

  const results = [];

  for (const c of customers) {
    const name = `${c.first_name} ${c.last_name}`;

    // Skip if already invoiced this week
    if (existingIds.has(c.id)) {
      results.push({ name, status: 'skipped', reason: 'Already charged this week' });
      continue;
    }

    // Per-client amount override from the admin panel; falls back to their standard price
    const override = amounts && typeof amounts === 'object' ? parseFloat(amounts[c.id]) : NaN;
    const chargeAmount = (!isNaN(override) && override >= 1) ? Math.round(override * 100) / 100 : c.price_per_visit;

    // Skip if no amount to charge
    if (!chargeAmount) {
      results.push({ name, status: 'skipped', reason: 'No price set' });
      continue;
    }

    // Skip if no Stripe customer
    if (!c.stripe_customer_id) {
      results.push({ name, status: 'skipped', reason: 'No card on file' });
      continue;
    }

    const amountCents = Math.round(chargeAmount * 100);

    try {
      // Get customer's saved payment method from Stripe
      const stripeCust = await stripe(`customers/${c.stripe_customer_id}`);
      let pmId = stripeCust.invoice_settings?.default_payment_method;

      // Fallback: list their payment methods and use the first card
      if (!pmId) {
        const pms = await stripe(`payment_methods?customer=${c.stripe_customer_id}&type=card`);
        pmId = pms.data?.[0]?.id;
      }

      if (!pmId) {
        results.push({ name, status: 'skipped', reason: 'No payment method found, send card setup link' });
        continue;
      }

      // Charge the card
      const pi = await stripe('payment_intents', 'POST', {
        amount: amountCents,
        currency: 'usd',
        customer: c.stripe_customer_id,
        payment_method: pmId,
        confirm: 'true',
        off_session: 'true',
        description: `Scoop N Go Arizona: Week of ${weekLabel}`,
        'metadata[customer_id]': c.id,
        'metadata[customer_name]': name,
        'metadata[period_start]': periodStart,
      });

      if (pi.status === 'succeeded') {
        // Create or update invoice to paid
        const dayMap = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };
        const serviceDayNum = dayMap[c.preferred_day] ?? 5;
        const dueDate = new Date(monday);
        dueDate.setDate(monday.getDate() + ((serviceDayNum - 1 + 7) % 7));
        const dueDateStr = fmt(dueDate <= sunday ? dueDate : sunday);

        // Check if a sent invoice already exists for this week, update it instead of creating a new one
        const existingInvRes = await supa(`invoices?customer_id=eq.${c.id}&period_start=eq.${periodStart}&status=eq.sent`);
        const existingInvData = await existingInvRes.json();
        const existingInv = Array.isArray(existingInvData) && existingInvData[0];

        if (existingInv) {
          await supa(`invoices?id=eq.${existingInv.id}`, 'PATCH', {
            status: 'paid',
            amount: chargeAmount,
            notes: `Week of ${weekLabel}, charged to card on file`,
            stripe_payment_intent_id: pi.id,
          });
        } else {
          await supa('invoices', 'POST', {
            customer_id:  c.id,
            amount:       chargeAmount,
            status:       'paid',
            due_date:     dueDateStr,
            period_start: periodStart,
            period_end:   periodEnd,
            notes:        `Week of ${weekLabel}, charged to card on file`,
            stripe_payment_intent_id: pi.id,
          });
        }

        // Send receipt email to customer (if they have an email)
        if (c.email) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${RESEND_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Scoop N Go Arizona <onboarding@resend.dev>',
              to: 'scoopngoarizona@gmail.com', // Resend restriction: can only send to verified email in test mode
              reply_to: c.email,
              subject: `Receipt: Scoop N Go Arizona: Week of ${weekLabel}`,
              html: `
                <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">
                  <h2 style="color:#1b5e20;">Payment Receipt</h2>
                  <p>Hi ${c.first_name},</p>
                  <p>Your card on file was charged for your weekly yard cleaning service. Here's your receipt:</p>
                  <table style="width:100%;border-collapse:collapse;margin:20px 0;">
                    <tr><td style="padding:8px 0;color:#555;">Service Week</td><td style="padding:8px 0;font-weight:bold;">${weekLabel}</td></tr>
                    <tr><td style="padding:8px 0;color:#555;">Service Type</td><td style="padding:8px 0;">${c.service_type || 'Weekly'}</td></tr>
                    <tr><td style="padding:8px 0;color:#555;">Amount Charged</td><td style="padding:8px 0;font-weight:bold;color:#1b5e20;">$${chargeAmount.toFixed(2)}</td></tr>
                  </table>
                  <p style="color:#555;font-size:14px;">Thank you for choosing Scoop N Go Arizona! 🐾</p>
                  <p style="color:#555;font-size:14px;">Questions? Reply to this email or text us anytime.</p>
                  <hr style="border:none;border-top:1px solid #eee;margin:20px 0;"/>
                  <p style="color:#aaa;font-size:12px;">Scoop N Go Arizona | East Valley, AZ | scoopngoarizona@gmail.com</p>
                </div>
              `,
            }),
          });
        }

        results.push({ name, status: 'charged', amount: chargeAmount });

      } else if (pi.status === 'requires_action' || pi.status === 'requires_payment_method') {
        const reason = `Card declined or requires action (${pi.status})`;
        await sendFailureEmail(name, c.phone, chargeAmount, reason, weekLabel, RESEND_KEY);
        results.push({ name, status: 'failed', reason });
      } else {
        const reason = `Unexpected status: ${pi.status}`;
        await sendFailureEmail(name, c.phone, chargeAmount, reason, weekLabel, RESEND_KEY);
        results.push({ name, status: 'failed', reason });
      }

    } catch (err) {
      await sendFailureEmail(name, c.phone, chargeAmount, err.message, weekLabel, RESEND_KEY);
      results.push({ name, status: 'failed', reason: err.message });
    }
  }

  const charged = results.filter(r => r.status === 'charged').length;
  const failed  = results.filter(r => r.status === 'failed').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const total   = results.filter(r => r.status === 'charged').reduce((s, r) => s + (r.amount || 0), 0);

  return res.status(200).json({ week: weekLabel, charged, failed, skipped, total, results });
}
