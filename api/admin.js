export default async function handler(req, res) {
  // CORS for same-origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth check
  const provided = req.headers['x-admin-password'];
  if (!provided || provided !== process.env.ADMIN_PASSWORD) {
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

  const { resource, id } = req.query;
  const allowed = ['leads','customers','dogs','appointments','invoices','payments'];
  if (!resource || !allowed.includes(resource)) {
    return res.status(400).json({ error: 'Invalid resource' });
  }

  let url = `${BASE}/${resource}`;

  try {
    if (req.method === 'GET') {
      const p = new URLSearchParams();
      if (resource === 'leads')        { p.set('order','created_at.desc'); p.set('limit','200'); }
      if (resource === 'customers')    { p.set('order','first_name.asc'); }
      if (resource === 'appointments') { p.set('order','scheduled_at.asc'); p.set('select','*,customers(first_name,last_name,phone,address,gate_code)'); }
      if (resource === 'invoices')     { p.set('order','due_date.asc'); p.set('select','*,customers(first_name,last_name,phone)'); }
      if (resource === 'dogs')         { p.set('order','name.asc'); }
      if (p.toString()) url += '?' + p.toString();

      const r = await fetch(url, { headers: hdrs });
      return res.status(r.status).json(await r.json());

    } else if (req.method === 'POST') {
      const r = await fetch(url, { method:'POST', headers: hdrs, body: JSON.stringify(req.body) });
      return res.status(r.status).json(await r.json());

    } else if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'ID required' });
      const r = await fetch(`${url}?id=eq.${id}`, { method:'PATCH', headers: hdrs, body: JSON.stringify(req.body) });
      return res.status(r.status).json(await r.json());

    } else if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'ID required' });
      await fetch(`${url}?id=eq.${id}`, { method:'DELETE', headers: hdrs });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
