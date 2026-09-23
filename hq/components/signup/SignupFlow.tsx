'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, CardBody, FormField, Input, Select, Textarea, useToast } from '@/components/ui';
import { useCopyableLink } from '@/components/clients/useCardSetupLink';
import { money, todayISO } from '@/lib/format';
import type { Customer } from '@/lib/types';
import {
  PRESETS,
  addDaysISO,
  cadenceLabel,
  coveredVisits,
  dayLabel,
  firstChargedVisit,
  serviceTypeFor,
  suggestedSignupTotal,
  weekdayName,
  type CoveredVisit,
  type SignupPlan,
} from '@/lib/signup-plan';

// The whole "sign her up" errand on one screen: the offer, the client, then the
// two things that actually have to happen afterwards, getting the signup money
// and getting a card kept for later. Step two stays on screen after the save
// because that is the part done standing in a driveway with the client waiting.

interface CreatedState {
  client: Customer;
  covered: CoveredVisit[];
  firstCharged: string;
  plan: SignupPlan;
  freeBooked: number; // comped visits already written to the books
}

interface CollectedState {
  amount: number;
  charged: boolean;
  method: string;
  weeks: CoveredVisit[];
  firstCharged: string;
  cardSaved?: boolean;
}

type LinkKind = 'signup' | 'setup';

const METHODS = [
  { key: 'applepay', label: 'Apple Pay' },
  { key: 'cash', label: 'Cash' },
  { key: 'venmo', label: 'Venmo' },
  { key: 'zelle', label: 'Zelle' },
  { key: 'check', label: 'Check' },
  { key: 'card', label: 'Card already on file (charge it now)' },
];

const FREQUENCIES = [
  { weeks: 1, label: 'Weekly' },
  { weeks: 2, label: 'Bi-weekly' },
  { weeks: 4, label: 'Monthly' },
];

const DAYS = [
  { name: 'Monday', index: 1 },
  { name: 'Tuesday', index: 2 },
  { name: 'Wednesday', index: 3 },
  { name: 'Thursday', index: 4 },
  { name: 'Friday', index: 5 },
  { name: 'Saturday', index: 6 },
  { name: 'Sunday', index: 0 },
];

type ClientDraft = {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  zip: string;
  gate_code: string;
  yard_notes: string;
};

const EMPTY_CLIENT: ClientDraft = {
  first_name: '', last_name: '', phone: '', email: '', address: '',
  city: '', zip: '', gate_code: '', yard_notes: '',
};

function weekdayIndex(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

// The next date that falls on this weekday, today included.
function nextWeekday(index: number): string {
  const today = todayISO();
  for (let i = 0; i < 7; i++) {
    const iso = addDaysISO(today, i);
    if (weekdayIndex(iso) === index) return iso;
  }
  return today;
}

// Default first visit: the soonest of the two days the route actually runs.
// It is only a default, the day and date fields are both right there.
const ROUTE_DAYS = [3, 5]; // Wednesday, Friday

function nextRouteDay(): string {
  const today = todayISO();
  for (let i = 0; i < 7; i++) {
    const iso = addDaysISO(today, i);
    if (ROUTE_DAYS.includes(weekdayIndex(iso))) return iso;
  }
  return today;
}

// A text message reads better without trailing cents on a round price.
function dollars(amount: number): string {
  return amount % 1 === 0 ? `$${amount}` : money(amount);
}

// The text he sends her, with her numbers already in it.
function signupMessage(
  firstName: string,
  url: string,
  plan: SignupPlan,
  kind: LinkKind
): string {
  const per = `${dollars(plan.price_per_visit)} every ${cadenceLabel(plan.frequency_weeks)}`;
  const paidVisits = Math.max(0, plan.covered_visits - plan.free_visits);
  const who = firstName || 'there';
  const freeBit =
    plan.free_visits > 0
      ? `Your first ${plan.free_visits > 1 ? `${plan.free_visits} cleanups are` : 'cleanup is'} free. `
      : '';

  if (kind === 'setup') {
    return [
      `Hi ${who}, it's Jett with Scoop N Go. Here's your secure link to put a card on file: ${url}`,
      `It's ${per}, charged to your card after each cleanup.`,
      'Nothing is charged until you save the card. Text me any time.',
    ].join('\n\n');
  }

  return [
    `Hi ${who}, it's Jett with Scoop N Go. Here's your secure link to get started: ${url}`,
    `${freeBit}The ${dollars(plan.signup_total)} covers your next ${paidVisits} ${
      paidVisits === 1 ? 'visit' : 'visits'
    }. The card you pay with is saved for after that, so every cleanup is just charged to it and you never have to enter it again.`,
    'Text me any time.',
  ].join('\n\n');
}

export function SignupFlow() {
  const router = useRouter();
  const toast = useToast();
  const copyLink = useCopyableLink();

  const [presetKey, setPresetKey] = useState(PRESETS[0].key);
  const [plan, setPlan] = useState<SignupPlan>(PRESETS[0].plan);
  // Once he types his own signup total, presets and price changes stop
  // overwriting it. A $60 deal on a $19 price is his call, not the formula's.
  const [totalEdited, setTotalEdited] = useState(false);
  const [client, setClient] = useState<ClientDraft>(EMPTY_CLIENT);
  const [firstVisit, setFirstVisit] = useState(nextRouteDay);
  // Off by default: he charges the card himself after each cleanup once the
  // prepaid weeks run out.
  const [autoCharge, setAutoCharge] = useState(false);
  const [dogs, setDogs] = useState('');
  const [saving, setSaving] = useState(false);

  const [created, setCreated] = useState<CreatedState | null>(null);
  const [link, setLink] = useState<{ url: string; kind: LinkKind } | null>(null);
  const [checking, setChecking] = useState(false);
  const [collectMethod, setCollectMethod] = useState('applepay');
  const [collectAmount, setCollectAmount] = useState('');
  const [collecting, setCollecting] = useState(false);
  const [collected, setCollected] = useState<CollectedState | null>(null);

  const preview = useMemo(() => coveredVisits(firstVisit, plan), [firstVisit, plan]);
  const previewFirstCharged = useMemo(
    () => firstChargedVisit(firstVisit, plan),
    [firstVisit, plan]
  );

  function setPlanField<K extends keyof SignupPlan>(key: K, value: number) {
    setPlan((p) => {
      const next = { ...p, [key]: value };
      if (key === 'signup_total') return next;
      // Keep the total in step with the offer until he overrides it.
      return totalEdited ? next : { ...next, signup_total: suggestedSignupTotal(next) };
    });
  }

  function applyPreset(key: string) {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setPresetKey(key);
    setPlan(preset.plan);
    setTotalEdited(false);
  }

  function setClientField(key: keyof ClientDraft, value: string) {
    setClient((c) => ({ ...c, [key]: value }));
  }

  async function save() {
    if (!client.first_name.trim()) {
      toast('First name is required', 'error');
      return;
    }
    if (!client.phone.trim()) {
      toast('Phone is required', 'error');
      return;
    }
    setSaving(true);
    let res: Response;
    try {
      res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client,
          plan,
          first_visit_date: firstVisit,
          auto_charge: autoCharge,
          dog_count: Number(dogs) || 0,
        }),
      });
    } catch {
      setSaving(false);
      toast('Could not reach the server. Check your connection and try again.', 'error');
      return;
    }
    setSaving(false);

    // A lapsed session redirects the write to the login page, which answers 200.
    if (res.redirected && new URL(res.url).pathname.startsWith('/login')) {
      toast('Your session expired. Sign in again, then re-save.', 'error');
      return;
    }

    const body = (await res.json().catch(() => null)) as {
      client?: Customer;
      covered?: CoveredVisit[];
      first_charged_visit?: string;
      free_booked?: number;
      dogs_error?: string;
      invoice_error?: string;
      error?: string;
    } | null;
    if (!res.ok || !body?.client) {
      toast(body?.error ?? 'Could not create the client', 'error');
      return;
    }
    if (body.dogs_error) toast('Client saved, but the dogs did not save', 'info');
    if (body.invoice_error) {
      toast('Client saved, but the free visit was not marked. Check her client page.', 'error');
    }

    setCreated({
      client: body.client,
      covered: body.covered ?? preview,
      firstCharged: body.first_charged_visit ?? previewFirstCharged,
      plan,
      freeBooked: body.free_booked ?? 0,
    });
    setCollectAmount(String(plan.signup_total));
    toast(`${body.client.first_name} is on the books`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    router.refresh();
  }

  // Both link buttons run synchronously off the tap so the clipboard write
  // survives iOS (see useCopyableLink).
  function copySignupLink() {
    if (!created) return;
    const id = created.client.id;
    copyLink
      .request(
        async () => {
          const res = await fetch('/api/signup/link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customer_id: id,
              amount: created.plan.signup_total,
              covered_visits: created.plan.covered_visits,
              free_visits: created.plan.free_visits,
              first_visit_date: created.client.start_date ?? firstVisit,
            }),
          });
          const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
          if (!res.ok || !data.url) throw new Error(data.error || 'Could not create the link');
          return data.url;
        },
        { name: created.client.first_name, what: 'Signup link' }
      )
      .then((url) => {
        if (url) setLink({ url, kind: 'signup' });
      });
  }

  function copyCardSetupLink() {
    if (!created) return;
    const c = created.client;
    copyLink
      .request(
        async () => {
          const res = await fetch('/api/stripe/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customer_id: c.id,
              customer_name: `${c.first_name} ${c.last_name ?? ''}`.trim(),
              customer_email: c.email,
              stripe_customer_id: c.stripe_customer_id,
            }),
          });
          const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
          if (!res.ok || !data.url) throw new Error(data.error || 'Could not create the link');
          return data.url;
        },
        { name: c.first_name, what: 'Card setup link' }
      )
      .then((url) => {
        if (url) setLink({ url, kind: 'setup' });
      });
  }

  // Asks Stripe whether she finished the link. On a yes this also keeps her
  // card and marks the covered weeks paid.
  async function checkPayment() {
    if (!created) return;
    setChecking(true);
    try {
      const res = await fetch('/api/signup/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: created.client.id }),
      });
      const body = (await res.json().catch(() => null)) as {
        paid?: boolean;
        card_saved?: boolean;
        amount?: number;
        weeks?: CoveredVisit[];
        first_charged_visit?: string;
        problems?: string[];
        reason?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        toast(body?.error ?? 'Could not check with Stripe', 'error');
        return;
      }
      if (!body?.paid) {
        toast(body?.reason ?? 'Nothing paid yet', 'info');
        return;
      }
      setCollected({
        amount: body.amount ?? created.plan.signup_total,
        charged: true,
        method: 'card',
        weeks: body.weeks?.length ? body.weeks : created.covered,
        firstCharged: body.first_charged_visit ?? created.firstCharged,
        cardSaved: body.card_saved,
      });
      toast(body.problems?.length ? `Paid, but check: ${body.problems[0]}` : 'She paid, card kept');
      router.refresh();
    } catch {
      toast('Could not check with Stripe', 'error');
    } finally {
      setChecking(false);
    }
  }

  async function collect() {
    if (!created) return;
    const amount = collectValue(collectAmount, created.plan.signup_total);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Enter the amount collected', 'error');
      return;
    }
    setCollecting(true);
    try {
      const res = await fetch('/api/signup/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: created.client.id,
          method: collectMethod,
          amount,
          covered_visits: created.plan.covered_visits,
          free_visits: created.plan.free_visits,
          first_visit_date: created.client.start_date ?? firstVisit,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        charged?: boolean;
        method?: string;
        weeks?: CoveredVisit[];
        first_charged_visit?: string;
        problems?: string[];
        error?: string;
      } | null;
      if (!res.ok) {
        toast(body?.error ?? 'Could not record the signup', 'error');
        return;
      }
      setCollected({
        amount,
        charged: Boolean(body?.charged),
        method: body?.method ?? collectMethod,
        weeks: body?.weeks ?? created.covered,
        firstCharged: body?.first_charged_visit ?? created.firstCharged,
      });
      if (body?.problems?.length) {
        toast(`Recorded, but check: ${body.problems[0]}`, 'error');
      } else {
        toast(`${money(amount)} recorded, ${created.covered.length} visits covered`);
      }
      router.refresh();
    } catch {
      toast('Could not record the signup', 'error');
    } finally {
      setCollecting(false);
    }
  }

  function startAnother() {
    setCreated(null);
    setCollected(null);
    setLink(null);
    setClient(EMPTY_CLIENT);
    setDogs('');
    setFirstVisit(nextRouteDay());
    applyPreset(presetKey);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // --- step 2: the follow-through ---------------------------------------------

  if (created) {
    const name = `${created.client.first_name} ${created.client.last_name ?? ''}`.trim();
    const startDate = created.client.start_date ?? firstVisit;
    const prepaid = created.plan.covered_visits > 0 && created.plan.signup_total > 0;
    const message = link
      ? signupMessage(created.client.first_name, link.url, created.plan, link.kind)
      : '';
    const smsHref = `sms:${(created.client.phone ?? '').replace(/[^\d+]/g, '')}&body=${encodeURIComponent(message)}`;

    return (
      <div className="space-y-4">
        <Card>
          <CardBody>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-heading text-lg font-black text-ink">{name} is on the books</h2>
                <p className="text-sm text-muted mt-0.5">
                  {serviceTypeFor(created.plan.frequency_weeks)} on {weekdayName(startDate)}s,{' '}
                  {money(created.plan.price_per_visit)} a visit. First visit{' '}
                  {dayLabel(startDate, true)}.
                </p>
                {created.freeBooked > 0 && (
                  <p className="text-sm text-brand font-bold mt-1">
                    {created.freeBooked === 1 ? 'That visit is' : `The first ${created.freeBooked} visits are`}{' '}
                    already marked free, so nothing gets charged for{' '}
                    {created.freeBooked === 1 ? 'it' : 'them'}.
                  </p>
                )}
              </div>
              <Link
                href={`/clients/${created.client.id}`}
                className="text-sm font-heading font-bold text-brand hover:underline"
              >
                Open her client page
              </Link>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h3 className="font-heading font-bold text-ink mb-1">1. Send her the link</h3>
            <p className="text-sm text-muted mb-3">
              {prepaid
                ? `One link takes the ${money(created.plan.signup_total)} and keeps the card she pays with, so you can charge that same card after every cleanup from here on.`
                : 'Saving a card charges nothing on its own.'}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {prepaid && (
                <Button variant="primary" onClick={copySignupLink}>
                  {link?.kind === 'signup' ? 'New link' : `Copy the ${dollars(created.plan.signup_total)} link`}
                </Button>
              )}
              <Button variant={prepaid ? 'outline' : 'primary'} onClick={copyCardSetupLink}>
                {prepaid ? 'Card setup only, no charge' : 'Copy card setup link'}
              </Button>
            </div>

            {link && (
              <div className="mt-4 border-t border-line pt-4">
                <FormField
                  label={link.kind === 'signup' ? 'Her signup link' : 'Her card setup link'}
                >
                  <Input
                    readOnly
                    value={link.url}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label="Link"
                  />
                </FormField>
                <FormField label="The text to send her">
                  <Textarea readOnly value={message} rows={7} />
                </FormField>
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={smsHref}
                    className="inline-flex items-center rounded-[7px] bg-brand text-white px-4 py-2.5 text-[0.82rem] font-heading font-bold hover:bg-brand-dark"
                  >
                    Open Messages
                  </a>
                  <CopyButton label="Copy the text" value={message} />
                  <CopyButton label="Copy just the link" value={link.url} />
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center rounded-[7px] border-2 border-line px-4 py-2 text-[0.82rem] font-heading font-bold text-muted hover:border-brand hover:text-brand"
                  >
                    Open it
                  </a>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {created.plan.covered_visits > 0 && (
          <Card>
            <CardBody>
              <h3 className="font-heading font-bold text-ink mb-1">
                2. Signup payment, {money(created.plan.signup_total)}
              </h3>
              {collected ? (
                <div>
                  <p className="text-sm text-ink mb-1">
                    {money(collected.amount)}{' '}
                    {collected.charged ? 'paid by card' : `recorded as ${collected.method}`}. These
                    visits are covered, so nothing will be charged for them.
                  </p>
                  {collected.cardSaved && (
                    <p className="text-sm text-brand font-bold mb-2">
                      That card is saved on file. Charge it from her client page after each cleanup.
                    </p>
                  )}
                  <VisitList visits={collected.weeks} />
                  <p className="text-sm text-muted mt-3">
                    Her paid visits start {dayLabel(collected.firstCharged, true)}, at{' '}
                    {money(created.plan.price_per_visit)} every{' '}
                    {cadenceLabel(created.plan.frequency_weeks)}.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted mb-3">
                    Once she finishes the link, check here. That marks the covered visits paid so
                    she is not billed for them again.
                  </p>
                  <VisitList visits={created.covered} />
                  <div className="mt-4">
                    <Button variant="primary" onClick={checkPayment} disabled={checking}>
                      {checking ? 'Checking…' : 'Check if she paid'}
                    </Button>
                  </div>

                  <div className="mt-5 border-t border-line pt-4">
                    <p className="text-sm font-heading font-bold text-ink mb-2">
                      Paid you another way?
                    </p>
                    <div className="grid sm:grid-cols-2 gap-x-3">
                      <FormField label="How she paid">
                        <Select
                          value={collectMethod}
                          onChange={(e) => setCollectMethod(e.target.value)}
                        >
                          {METHODS.map((m) => (
                            <option key={m.key} value={m.key}>{m.label}</option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField label="Amount collected ($)">
                        <Input
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          value={collectAmount}
                          onChange={(e) => setCollectAmount(e.target.value)}
                        />
                      </FormField>
                    </div>
                    <Button onClick={collect} disabled={collecting}>
                      {collecting
                        ? 'Working…'
                        : `Record ${money(collectValue(collectAmount, created.plan.signup_total))}`}
                    </Button>
                    <p className="text-xs text-muted mt-2">
                      Cash and Venmo leave no card behind, so send her the card setup link too.
                    </p>
                  </div>
                </>
              )}
            </CardBody>
          </Card>
        )}

        <div className="flex items-center gap-2">
          <Button onClick={startAnother}>Sign up another client</Button>
          <Link
            href="/clients"
            className="inline-flex items-center rounded-[7px] border-2 border-line px-4 py-2 text-[0.82rem] font-heading font-bold text-muted hover:border-brand hover:text-brand"
          >
            All clients
          </Link>
        </div>
        {copyLink.modal}
      </div>
    );
  }

  // --- step 1: the offer and the client ---------------------------------------

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <h3 className="font-heading font-bold text-ink mb-3">The offer</h3>
          <div className="grid sm:grid-cols-3 gap-2 mb-4">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
                className={
                  'text-left rounded-card border-2 p-3 transition-colors ' +
                  (presetKey === p.key
                    ? 'border-brand bg-brand-light'
                    : 'border-line hover:border-brand')
                }
              >
                <div className="font-heading font-bold text-sm text-ink">{p.label}</div>
                <div className="text-xs text-muted mt-0.5">{p.hint}</div>
              </button>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-x-3">
            <FormField label="Price per visit ($)">
              <Input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={plan.price_per_visit}
                onChange={(e) => setPlanField('price_per_visit', parseFloat(e.target.value) || 0)}
              />
            </FormField>
            <FormField label="How often">
              <Select
                value={plan.frequency_weeks}
                onChange={(e) => setPlanField('frequency_weeks', Number(e.target.value))}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.weeks} value={f.weeks}>{f.label}</option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className="grid sm:grid-cols-3 gap-x-3">
            <FormField label="Visits the signup covers">
              <Input
                type="number"
                min="0"
                step="1"
                value={plan.covered_visits}
                onChange={(e) => setPlanField('covered_visits', Number(e.target.value) || 0)}
              />
            </FormField>
            <FormField label="Of those, free">
              <Input
                type="number"
                min="0"
                step="1"
                value={plan.free_visits}
                onChange={(e) => setPlanField('free_visits', Number(e.target.value) || 0)}
              />
            </FormField>
            <FormField label="Signup total ($)">
              <Input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={plan.signup_total}
                onChange={(e) => {
                  setTotalEdited(true);
                  setPlanField('signup_total', parseFloat(e.target.value) || 0);
                }}
              />
            </FormField>
          </div>

          <div className="grid sm:grid-cols-2 gap-x-3">
            <FormField label="Day of service">
              <Select
                value={weekdayIndex(firstVisit)}
                onChange={(e) => setFirstVisit(nextWeekday(Number(e.target.value)))}
              >
                {DAYS.map((d) => (
                  <option key={d.index} value={d.index}>{d.name}</option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="First visit"
              hint={`Every visit after this one lands on a ${weekdayName(firstVisit)}.`}
            >
              <Input
                type="date"
                value={firstVisit}
                onChange={(e) => e.target.value && setFirstVisit(e.target.value)}
              />
            </FormField>
          </div>

          <PlanPreview
            visits={preview}
            plan={plan}
            firstCharged={previewFirstCharged}
          />

          <label className="flex items-start gap-2 mt-4 text-sm">
            <input
              type="checkbox"
              checked={autoCharge}
              onChange={(e) => setAutoCharge(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Auto-charge her card when a visit is marked done
              <span className="block text-xs text-muted">
                Leave this off to charge her by hand from her client page after each cleanup.
                Either way, prepaid and free weeks are skipped.
              </span>
            </span>
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h3 className="font-heading font-bold text-ink mb-3">Her details</h3>
          <div className="grid sm:grid-cols-2 gap-x-3">
            <FormField label="First name (required)">
              <Input
                value={client.first_name}
                onChange={(e) => setClientField('first_name', e.target.value)}
              />
            </FormField>
            <FormField label="Last name">
              <Input
                value={client.last_name}
                onChange={(e) => setClientField('last_name', e.target.value)}
              />
            </FormField>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-3">
            <FormField label="Phone (required)">
              <Input
                type="tel"
                inputMode="tel"
                value={client.phone}
                onChange={(e) => setClientField('phone', e.target.value)}
              />
            </FormField>
            <FormField label="Email">
              <Input
                type="email"
                spellCheck={false}
                value={client.email}
                onChange={(e) => setClientField('email', e.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Address">
            <Input
              value={client.address}
              onChange={(e) => setClientField('address', e.target.value)}
            />
          </FormField>
          <div className="grid sm:grid-cols-2 gap-x-3">
            <FormField label="City">
              <Input value={client.city} onChange={(e) => setClientField('city', e.target.value)} />
            </FormField>
            <FormField label="ZIP">
              <Input
                inputMode="numeric"
                value={client.zip}
                onChange={(e) => setClientField('zip', e.target.value)}
              />
            </FormField>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-3">
            <FormField label="Gate code">
              <Input
                value={client.gate_code}
                onChange={(e) => setClientField('gate_code', e.target.value)}
              />
            </FormField>
            <FormField label="How many dogs" hint="Name them later on her page if you want.">
              <Input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={dogs}
                onChange={(e) => setDogs(e.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Yard notes / access">
            <Textarea
              value={client.yard_notes}
              onChange={(e) => setClientField('yard_notes', e.target.value)}
            />
          </FormField>

          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Add her and get the link'}
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

// --- small pieces --------------------------------------------------------------

// What the button will actually take: whatever he typed, or the signup total
// when the box is empty.
function collectValue(typed: string, fallback: number): number {
  const n = parseFloat(typed);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : fallback;
}

function VisitList({ visits }: { visits: CoveredVisit[] }) {
  if (!visits.length) return null;
  return (
    <ul className="rounded-card border border-line divide-y divide-line">
      {visits.map((v) => (
        <li key={v.visitDate} className="flex items-center justify-between px-3 py-2 text-sm">
          <span className="text-ink">{dayLabel(v.visitDate, true)}</span>
          <span className={v.free ? 'font-heading font-bold text-brand' : 'text-muted tabular-nums'}>
            {v.free ? 'Free' : money(v.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PlanPreview({
  visits,
  plan,
  firstCharged,
}: {
  visits: CoveredVisit[];
  plan: SignupPlan;
  firstCharged: string;
}) {
  const per = `${money(plan.price_per_visit)} every ${cadenceLabel(plan.frequency_weeks)}`;
  if (!visits.length) {
    return (
      <div className="rounded-card bg-tan border border-line p-3 text-sm text-ink">
        Nothing collected today. She is billed {per} from her first visit on{' '}
        {dayLabel(firstCharged, true)}.
      </div>
    );
  }
  return (
    <div className="rounded-card bg-tan border border-line p-3">
      <p className="text-sm text-ink mb-2">
        She pays <strong>{money(plan.signup_total)}</strong> today, which covers{' '}
        {visits.length} {visits.length === 1 ? 'visit' : 'visits'}:
      </p>
      <VisitList visits={visits} />
      <p className="text-sm text-muted mt-2">
        Then {per}, starting {dayLabel(firstCharged, true)}.
      </p>
    </div>
  );
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
      toast('Copied');
    } catch {
      toast('Copy is blocked here, tap the box and copy by hand', 'error');
    }
  }
  return <Button onClick={copy}>{done ? 'Copied' : label}</Button>;
}
