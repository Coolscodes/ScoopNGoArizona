export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { first_name, last_name, phone, email, address, zip, dogs, service_type, notes, source } = req.body;

  const fullAddress = [address, zip].filter(Boolean).join(', ');

  // RESEND_FROM must be a sender on a Resend-verified domain, e.g.
  // "Scoop N Go Arizona <hello@scoopngoarizona.com>". Until it is set, the
  // sandbox sender is used for the owner notification and the customer
  // auto-response is skipped (sandbox can only email the account owner).
  const FROM = process.env.RESEND_FROM || 'Scoop N Go Arizona <onboarding@resend.dev>';
  const canEmailCustomers = Boolean(process.env.RESEND_FROM);

  const emailBody = `
New quote request from your website!

Name:      ${first_name} ${last_name}
Phone:     ${phone}
Email:     ${email}
Address:   ${fullAddress || 'Not provided'}
Dogs:      ${dogs}
Service:   ${service_type}
Source:    ${source || 'Direct'}
Notes:     ${notes || 'None'}

Reply to this email or call/text them to close the deal! 🐾
  `.trim();

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:     FROM,
        to:       'scoopngoarizona@gmail.com',
        reply_to: email,
        subject:  `🐾 New Quote Request: ${first_name} ${last_name} (${service_type})`,
        text:     emailBody,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Resend error');

    // Instant auto-response to the lead. Best-effort: never blocks or fails the
    // owner notification. Only runs once RESEND_FROM (verified domain) is set.
    if (canEmailCustomers && email) {
      const confirmBody = `
Hi ${first_name}!

Thanks for requesting a quote from Scoop N Go Arizona. We got it, and a real human will reach out shortly, usually within 2 hours during business hours.

Here is what you sent us:
Service:  ${service_type}
Dogs:     ${dogs}
Address:  ${fullAddress || 'Not provided'}

Want to skip the wait? Build your plan and see your exact price at https://scoopngoarizona.com/#pricing. New clients get their first cleanup FREE on weekly and bi-weekly plans.

Questions? Call or text us anytime at 602-622-0238.

Talk soon!
Scoop N Go Arizona
      `.trim();

      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from:     FROM,
            to:       email,
            reply_to: 'scoopngoarizona@gmail.com',
            subject:  '🐾 We got your quote request! Scoop N Go Arizona',
            text:     confirmBody,
          }),
        });
      } catch (err) {
        console.error('Auto-response error (owner notify already sent):', err.message);
      }
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Email error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
