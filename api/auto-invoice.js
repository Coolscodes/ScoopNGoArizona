// Weekly invoice generator
// Accepts: CRON_SECRET header (Vercel cron) OR x-admin-password header (manual button)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password, x-cron-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const cronSecret  = req.headers['x-cron-secret'] || req.query.secret;
  const adminPass   = req.headers['x-admin-password'];
  const validCron   = cronSecret && cronSecret === process.env.CRON_SECRET;
  const validAdmin  = adminPass  && adminPass  === process.env.ADMIN_PASSWORD;

  if (!validCron && !validAdmin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const BASE = 'https://emvqtgsjdbyaionxguhq.supabase.co/rest/v1';
  const KEY  = process.env.SUPABASE_SERVICE_KEY;
  const hdrs = {
    'apikey': KEY,
    'Authorization': `Bearer ${KEY}`,
    'Content-Type': 'application/json',
  };

  // Get Monday of the current week as period_start (invoices are per-week)
  const now       = new Date();
  const day       = now.getDay(); // 0=Sun, 1=Mon...
  const diffToMon = (day === 0) ? -6 : 1 - day;
  const monday    = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  const sunday    = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fmt = d => d.toISOString().split('T')[0];
  const periodStart = fmt(monday);
  const periodEnd   = fmt(sunday);

  // Human-readable week label e.g. "Jun 9 - Jun 15, 2026"
  const fmtLabel = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekLabel = `${fmtLabel(monday)} to ${fmtLabel(sunday)}, ${monday.getFullYear()}`;

  // When triggered by cron, only invoice customers whose service day matches today
  // When triggered manually by admin, invoice all active customers
  const todayName = now.toLocaleDateString('en-US', { weekday: 'long' }); // e.g. "Wednesday"
  const custUrl = validCron
    ? `${BASE}/customers?active=eq.true&preferred_day=eq.${todayName}&order=first_name.asc`
    : `${BASE}/customers?active=eq.true&order=first_name.asc`;

  const custRes = await fetch(custUrl, { headers: hdrs });
  const customers = await custRes.json();

  if (!Array.isArray(customers) || !customers.length) {
    return res.status(200).json({ message: 'No active customers found', week: weekLabel });
  }

  // Check which customers already have an invoice for this week
  const invRes = await fetch(`${BASE}/invoices?period_start=eq.${periodStart}`, { headers: hdrs });
  const existing = await invRes.json();
  const existingIds = new Set((Array.isArray(existing) ? existing : []).map(i => i.customer_id));

  const results = [];

  for (const c of customers) {
    if (existingIds.has(c.id)) {
      results.push({ name: `${c.first_name} ${c.last_name}`, status: 'skipped (already invoiced this week)' });
      continue;
    }

    if (!c.price_per_visit) {
      results.push({ name: `${c.first_name} ${c.last_name}`, status: 'skipped (no price set)' });
      continue;
    }

    // Due date = their service day this week, or Friday if none set
    const dayMap = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };
    const serviceDayNum = dayMap[c.preferred_day] ?? 5;
    const dueDate = new Date(monday);
    dueDate.setDate(monday.getDate() + ((serviceDayNum - 1 + 7) % 7));
    // Keep due date within the week
    const dueDateStr = fmt(dueDate <= sunday ? dueDate : sunday);

    const invoice = {
      customer_id:  c.id,
      amount:       c.price_per_visit,
      status:       'sent',
      due_date:     dueDateStr,
      period_start: periodStart,
      period_end:   periodEnd,
      notes:        `Week of ${weekLabel} - ${c.service_type || 'Visit'}`,
    };

    const r = await fetch(`${BASE}/invoices`, {
      method: 'POST',
      headers: { ...hdrs, 'Prefer': 'return=minimal' },
      body: JSON.stringify(invoice),
    });

    results.push({
      name:   `${c.first_name} ${c.last_name}`,
      amount: c.price_per_visit,
      status: r.ok ? 'created' : `error ${r.status}`,
    });
  }

  const created = results.filter(r => r.status === 'created').length;
  const skipped = results.filter(r => r.status.startsWith('skipped')).length;

  return res.status(200).json({ week: weekLabel, created, skipped, results });
}
