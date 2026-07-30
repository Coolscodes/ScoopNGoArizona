// The first-touch text we send a Meta lead, built from their own form answers.
//
// WHY THIS EXISTS
// ===============
// A lead who fills out an instant form has told us their city, their dog count
// and how often they want service. Reading those three back to them is the whole
// pitch of the first text: it proves a person looked at the request, and it turns
// the reply into a one word "yep" instead of a conversation. That message has to
// be assembled from the lead row, so it lives here rather than being typed out.
//
// This module is send-channel agnostic on purpose. Right now the text goes out
// from Jett's own phone via a prefilled sms: link (see smsLink below), but if we
// ever move to Twilio the same leadReplyText() feeds it unchanged.
//
// House style: no dashes as punctuation anywhere in customer-facing copy.

export interface ReplyLead {
  firstName?: string | null;
  city?: string | null;
  zip?: string | null;
  dogs?: string | null;
  frequency?: string | null;
  createdAt?: string | null;
}

// A phone is useless to us if it is all one repeated digit or too short to dial.
// The very first real lead came in as 11111111111, so junk numbers are the norm,
// not the exception, and every caller needs the same answer about them.
export function phoneLooksFake(raw?: string | null): boolean {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length < 10) return true;
  // Strip a leading US country code before checking for a repeated digit, so
  // 1-111-111-1111 is caught the same as 111-111-1111.
  const local = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return /^(\d)\1+$/.test(local);
}

// Meta gives phones back in a few shapes ("+14805551234", "4805551234",
// "(480) 555-1234"). Everything downstream wants E.164. Returns '' when there is
// nothing dialable, which callers use to decide whether to offer a text at all.
export function toE164(raw?: string | null): string {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length >= 11 && d.length <= 15) return `+${d}`;
  return '';
}

// "a few minutes ago" is true when the poller catches a lead on its 5 minute
// cycle, and a lie the morning after a lead came in at 11pm. Three buckets is
// enough to never sound wrong.
function whenPhrase(createdAt?: string | null, now: Date = new Date()): string {
  if (!createdAt) return 'a few minutes ago';
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return 'a few minutes ago';
  const minutes = (now.getTime() - t) / 60000;
  if (minutes < 45) return 'a few minutes ago';
  if (minutes < 600) return 'earlier today';
  return 'recently';
}

// The city question is not on every version of the form, so fall back to the zip.
function placePhrase(lead: ReplyLead): string {
  return (lead.city ?? '').trim() || (lead.zip ?? '').trim();
}

// The dogs answer arrives as "2", "3+", or occasionally "2 dogs" depending on
// whether the form used a dropdown or a free text field.
function dogPhrase(raw?: string | null): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  if (/dog/i.test(s)) return s.toLowerCase();
  const n = s.match(/^(\d+)\+?$/);
  if (n) return `${s} ${n[1] === '1' ? 'dog' : 'dogs'}`;
  return `${s} dogs`;
}

// Form option labels get rewritten every time the form is rebuilt, so normalize
// to something that reads naturally in "..., and weekly service?". Order matters:
// "twice a week" and "every other week" both contain "week".
function frequencyPhrase(raw?: string | null): string {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s.includes('one time') || s.includes('one-time') || s.includes('once')) {
    return 'a one time cleanup';
  }
  if (s.includes('twice')) return 'twice a week service';
  if (s.includes('other week') || s.includes('biweek') || s.includes('bi-week')) {
    return 'every other week service';
  }
  if (s.includes('week')) return 'weekly service';
  if (s.includes('month')) return 'monthly service';
  return `${s} service`;
}

// "Chandler, 2 dogs, and weekly service" / "Chandler and 2 dogs" / "Chandler"
function joinList(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/**
 * The exact text to send a new lead. Safe on a half empty lead: a missing name
 * becomes "Hi there", and a lead with nothing to confirm gets an open question
 * instead of a dangling "I just want to confirm:".
 */
export function leadReplyText(lead: ReplyLead, now: Date = new Date()): string {
  const name = (lead.firstName ?? '').trim();
  const greeting = name ? `Hi ${name}` : 'Hi there';
  const opener =
    `${greeting} this is Jett with Scoop N Go dog waste removal. ` +
    `I saw your request come in ${whenPhrase(lead.createdAt, now)}.`;

  const details = [placePhrase(lead), dogPhrase(lead.dogs), frequencyPhrase(lead.frequency)].filter(
    Boolean
  );

  if (details.length === 0) {
    return (
      `${opener}\n\n` +
      `Quick question so I can get you a price: how many dogs do you have, ` +
      `and what part of the East Valley are you in?`
    );
  }

  return `${opener}\n\nI just want to confirm:\n\n${joinList(details)}?`;
}

/**
 * A tap-to-send link that opens Messages with the recipient and the whole body
 * already filled in, so the text goes out from Jett's real number.
 *
 * iOS and macOS Messages want `sms:<number>&body=<text>` (Android would want a
 * `?`). Returns '' for a missing or junk number, so callers hide the button on a
 * bad lead rather than render a link that texts 111-111-1111.
 */
export function smsLink(phone: string | null | undefined, body: string): string {
  if (phoneLooksFake(phone)) return '';
  const to = toE164(phone);
  if (!to) return '';
  return `sms:${to}&body=${encodeURIComponent(body)}`;
}

export function telLink(phone: string | null | undefined): string {
  if (phoneLooksFake(phone)) return '';
  const to = toE164(phone);
  return to ? `tel:${to}` : '';
}
