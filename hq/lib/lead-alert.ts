// The "new lead" alert, in all three shapes it gets delivered in.
//
// WHY THIS IS NOT IN THE ROUTE
// ============================
// A Next route file may only export its handlers, so anything living there is
// impossible to render in a preview or exercise from a script. The alert is the
// one thing in the Meta pipeline that has to look right on a phone screen at
// 9pm, so it lives here where it can be checked without waiting for a real lead.
//
// Three bodies, one lead:
//   alertSubject  the inbox line
//   alertText     plain text fallback, also the whole email in a text-only client
//   alertHtml     the real one, with the tap to text button
//   alertSms      155 chars for the carrier gateway, which truncates at 160
//
// House style: no dashes as punctuation in anything the customer eventually sees.

import { leadReplyText, smsLink, telLink } from './lead-reply';

export interface LeadAlert {
  createdAt: string;
  first: string;
  last: string;
  email: string;
  phone: string;
  zip: string;
  city: string;
  dogs: string;
  frequency: string;
  suspectPhone: boolean;
}

function fullName(lead: LeadAlert, fallback: string): string {
  return [lead.first, lead.last].filter(Boolean).join(' ') || fallback;
}

function isOneTime(lead: LeadAlert): boolean {
  return lead.frequency.toLowerCase().includes('one time');
}

function submittedAt(lead: LeadAlert): string {
  return new Date(lead.createdAt).toLocaleString('en-US', { timeZone: 'America/Phoenix' });
}

/** The first-touch reply, filled in from this lead's own answers. */
export function replyText(lead: LeadAlert): string {
  return leadReplyText({
    firstName: lead.first,
    city: lead.city,
    zip: lead.zip,
    dogs: lead.dogs,
    frequency: lead.frequency,
    createdAt: lead.createdAt,
  });
}

// Every value in the HTML below is typed by a stranger into a Facebook form, so
// none of it is trusted. An unescaped angle bracket in a name would at best break
// the layout of the one email that has to be readable in a hurry.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function alertSubject(lead: LeadAlert): string {
  const where = lead.city || lead.zip || 'the East Valley';
  return `New lead: ${fullName(lead, 'Someone')}, ${where}`;
}

export function alertText(lead: LeadAlert): string {
  const lines = [
    `NEW SCOOP N GO LEAD`,
    ``,
    `Name:      ${fullName(lead, '(no name given)')}`,
    `Phone:     ${lead.phone || '(none)'}${lead.suspectPhone ? '   <-- LOOKS FAKE, use email' : ''}`,
    `Email:     ${lead.email || '(none)'}`,
    `City:      ${lead.city || '(not asked)'}`,
    `Zip:       ${lead.zip || '(none)'}`,
    `Dogs:      ${lead.dogs || '(none)'}`,
    `Frequency: ${lead.frequency || '(none)'}`,
    ``,
    `Submitted: ${submittedAt(lead)} Phoenix`,
  ];
  if (isOneTime(lead)) {
    lines.push(``, `Note: they picked a one time cleanup, which does not qualify`);
    lines.push(`for the free first cleanup. Quote the one time price, then offer`);
    lines.push(`weekly as the cheaper option.`);
  }
  if (!lead.suspectPhone) {
    lines.push(``, `--`, `Text to send back:`, ``, replyText(lead));
  }
  return lines.join('\n');
}

// The HTML exists for one reason: a tappable button that opens Messages with the
// reply already written and addressed. Meta cannot text a lead for us, and a
// Twilio number would not be Jett's own number, so the fastest honest path is one
// tap on the phone already in his hand.
//
// Gmail strips <style> blocks and most positioning, so this is all inline styles
// on tables and anchors, which is what survives.
export function alertHtml(lead: LeadAlert): string {
  const reply = replyText(lead);
  const sms = lead.suspectPhone ? '' : smsLink(lead.phone, reply);
  const tel = lead.suspectPhone ? '' : telLink(lead.phone);

  const rows: Array<[string, string]> = [
    ['Name', esc(fullName(lead, '(no name given)'))],
    [
      'Phone',
      esc(lead.phone || '(none)') +
        (lead.suspectPhone ? ' <span style="color:#b91c1c">&#9888; looks fake, use email</span>' : ''),
    ],
    ['Email', esc(lead.email || '(none)')],
    ['City', esc(lead.city || '(not asked)')],
    ['Zip', esc(lead.zip || '(none)')],
    ['Dogs', esc(lead.dogs || '(none)')],
    ['Frequency', esc(lead.frequency || '(none)')],
    ['Submitted', `${esc(submittedAt(lead))} Phoenix`],
  ];

  const table = rows
    .map(
      ([label, value]) =>
        `<tr>` +
        `<td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px;white-space:nowrap">${label}</td>` +
        `<td style="padding:4px 0;color:#111827;font-size:14px;font-weight:600">${value}</td>` +
        `</tr>`
    )
    .join('');

  const button = sms
    ? `<a href="${esc(sms)}" style="display:inline-block;background:#16a34a;color:#ffffff;` +
      `font-size:17px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:8px">` +
      `Text ${esc(lead.first || 'this lead')}</a>`
    : `<p style="margin:0;color:#b91c1c;font-size:14px;font-weight:600">` +
      `No usable phone number, reply by email instead.</p>`;

  const call = tel
    ? `<a href="${esc(tel)}" style="display:inline-block;margin-left:10px;color:#111827;` +
      `font-size:15px;font-weight:600;text-decoration:none;padding:14px 20px;border-radius:8px;` +
      `border:1px solid #d1d5db">Call</a>`
    : '';

  const preview = sms
    ? `<p style="margin:0 0 6px;color:#6b7280;font-size:13px">Sends this from your number:</p>` +
      `<div style="white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;` +
      `border-radius:8px;padding:14px;color:#111827;font-size:14px;line-height:1.5">${esc(reply)}</div>`
    : '';

  const oneTime = isOneTime(lead)
    ? `<p style="margin:20px 0 0;padding:12px;background:#fffbeb;border-left:3px solid #f59e0b;` +
      `color:#78350f;font-size:14px">They picked a one time cleanup, which does not qualify for ` +
      `the free first cleanup. Quote the one time price, then offer weekly as the cheaper option.</p>`
    : '';

  return (
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;` +
    `max-width:520px;margin:0 auto;padding:24px">` +
    `<h1 style="margin:0 0 16px;font-size:20px;color:#111827">New Scoop N Go lead</h1>` +
    `<table style="border-collapse:collapse;margin-bottom:24px">${table}</table>` +
    `<div style="margin-bottom:16px">${button}${call}</div>` +
    preview +
    oneTime +
    `</div>`
  );
}

// Carrier SMS gateways cut the body at 160 characters (Verizon's vtext.com does),
// so the phone gets its own compressed version. The full breakdown goes to email.
export function alertSms(lead: LeadAlert): string {
  const where = [lead.city, lead.zip].filter(Boolean).join(' ');
  const what = [lead.dogs, lead.frequency].filter(Boolean).join(', ');
  const contact = lead.suspectPhone ? `${lead.email} (bad ph)` : lead.phone || lead.email;
  return `LEAD: ${fullName(lead, 'No name')}, ${where}. ${what}. ${contact}`.slice(0, 155);
}
