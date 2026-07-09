export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { first_name, last_name, phone, email, address, zip, dogs, service_type, notes, source } = req.body;

  const fullAddress = [address, zip].filter(Boolean).join(', ');

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
        from:     'Scoop N Go Arizona <onboarding@resend.dev>',
        to:       'scoopngoarizona@gmail.com',
        reply_to: email,
        subject:  `🐾 New Quote Request: ${first_name} ${last_name} (${service_type})`,
        text:     emailBody,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Resend error');
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Email error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
