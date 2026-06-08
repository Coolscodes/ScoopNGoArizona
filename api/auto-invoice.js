// Auto-invoice generator — call on the 1st of each month
// Protected by CRON_SECRET so only Vercel cron or you can trigger it
export default async function handler(req, res) {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const BASE = 'https://emvqtgsjdbyaionxguhq.supabase.co/rest/v1';
  const KEY  = process.env.SUPABASE_SERVICE_KEY;
  const hdrs = {
    'apikey': KEY,
    'Authorization': `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  // Figure out billing period (current month)
  const now        = new Date();
  const year       = now.getFullYear();
  const month      = now.getMonth(); // 0-indexed
  const periodStart = `${year}-${String(month + 1).padStart(2,'0')}-01`;
  const lastDay     = new Date(year, month + 1, 0).getDate();
  const periodEnd   = `${year}-${String(month + 1).padStart(2,'0')}-${lastDay}`;
  const dueDate     = periodEnd;
  const monthName   = now.toLocaleString('en-US', { month: 'long' });

  // Get all active customers
  const custRes = await fetch(`${BASE}/customers?active=eq.true&order=first_name.asc`, { headers: hdrs });
  const customers = await custRes.json();

  if (!Array.isArray(customers) || !customers.length) {
    return res.status(200).json({ message: 'No active customers found' });
  }

  // Check which customers already have an invoice this month
  const invRes = await fetch(`${BASE}/invoices?period_start=eq.${periodStart}`, { headers: hdrs });
  const existing = await invRes.json();
  const existingIds = new Set((Array.isArray(existing) ? existing : []).map(i => i.customer_id));

  const results = [];

  for (const c of customers) {
    if (existingIds.has(c.id)) {
      results.push({ name: `${c.first_name} ${c.last_name}`, status: 'skipped (already exists)' });
      continue;
    }

    const amount = c.price_per_visit
      ? (c.service_type === 'Monthly' ? c.price_per_visit : c.price_per_visit * 4)
      : 0;

    if (!amount) {
      results.push({ name: `${c.first_name} ${c.last_name}`, status: 'skipped (no price set)' });
      continue;
    }

    const invoice = {
      customer_id:  c.id,
      amount,
      status:       'sent',
      due_date:     dueDate,
      period_start: periodStart,
      period_end:   periodEnd,
      notes:        `${monthName} ${year} - ${c.service_type}`,
    };

    const r = await fetch(`${BASE}/invoices`, {
      method: 'POST',
      headers: { ...hdrs, 'Prefer': 'return=minimal' },
      body: JSON.stringify(invoice),
    });

    results.push({
      name:   `${c.first_name} ${c.last_name}`,
      amount,
      status: r.ok ? 'created' : `error ${r.status}`,
    });
  }

  return res.status(200).json({ period: `${monthName} ${year}`, results });
}
