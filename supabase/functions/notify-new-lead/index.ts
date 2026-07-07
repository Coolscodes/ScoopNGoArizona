import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

serve(async (req) => {
  try {
    const payload = await req.json();
    const lead = payload.record;

    const emailBody = `
New quote request from your website!

Name:         ${lead.first_name} ${lead.last_name}
Phone:        ${lead.phone}
Email:        ${lead.email}
Zip Code:     ${lead.zip}
Dogs:         ${lead.dogs}
Service:      ${lead.service_type}
Notes:        ${lead.notes || 'None'}
Submitted:    ${new Date(lead.created_at).toLocaleString('en-US', { timeZone: 'America/Phoenix' })}

Reply to this email or call/text them directly to close the deal!
    `.trim();

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Scoop N Go Arizona <leads@scoopngoarizona.com>',
        to:   'ScoopNgoarizona@gmail.com',
        reply_to: lead.email,
        subject: `🐾 New Quote Request, ${lead.first_name} ${lead.last_name} (${lead.service_type})`,
        text: emailBody,
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), { status: 200 });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
