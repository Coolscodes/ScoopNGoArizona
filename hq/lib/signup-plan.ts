// Signup-offer math, shared by the browser form (/signup) and the two API
// routes that back it. Deliberately pure: no Supabase, no Stripe, no env, no
// date-fns, so the same function answers the same way in the form preview and
// on the server that writes the invoices.
//
// The offer this was built for: a new weekly client pays $60 at signup, the
// first cleanup is free, and that $60 covers the next three weeks. Week five
// is where the standing $20 auto-charge takes over. Nothing here is hardcoded
// to those numbers; every one of them is a field on SignupPlan.

import type { ServiceType } from './types';

export interface SignupPlan {
  price_per_visit: number;
  frequency_weeks: number; // 1 weekly, 2 bi-weekly, 4 monthly
  covered_visits: number; // visits the signup payment buys, free ones included
  free_visits: number; // how many of those are comped
  signup_total: number; // what they actually hand over today
}

export interface CoveredVisit {
  visitDate: string; // YYYY-MM-DD, the day she gets serviced
  periodStart: string; // Monday of the billing week that visit falls in
  periodEnd: string; // Sunday of it
  weekLabel: string; // "Sep 28 to Oct 4, 2026"
  amount: number; // what this week is credited, 0 for the free one
  free: boolean;
}

export interface SignupPreset {
  key: string;
  label: string;
  hint: string;
  plan: SignupPlan;
}

// Every preset is a starting point: the form leaves all five numbers editable.
export const PRESETS: SignupPreset[] = [
  {
    key: 'weekly-free-first',
    label: 'Weekly, first week free',
    hint: '$20 a week. $60 today covers 4 weeks.',
    plan: {
      price_per_visit: 20,
      frequency_weeks: 1,
      covered_visits: 4,
      free_visits: 1,
      signup_total: 60,
    },
  },
  {
    key: 'biweekly-free-first',
    label: 'Bi-weekly, first visit free',
    hint: '$25 a visit. $75 today covers 4 visits.',
    plan: {
      price_per_visit: 25,
      frequency_weeks: 2,
      covered_visits: 4,
      free_visits: 1,
      signup_total: 75,
    },
  },
  {
    key: 'no-prepay',
    label: 'No prepay',
    hint: 'Standing price only, nothing collected today.',
    plan: {
      price_per_visit: 20,
      frequency_weeks: 1,
      covered_visits: 0,
      free_visits: 0,
      signup_total: 0,
    },
  },
];

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- date helpers (UTC-pinned string math, same approach as charge-core) ------

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function mondayOfISO(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0=Sun
  return addDaysISO(iso, day === 0 ? -6 : 1 - day);
}

export function isISODate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// "Oct 2" / "Fri, Oct 2", rendered in UTC so the string never drifts a day.
export function dayLabel(iso: string, withWeekday = false): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    ...(withWeekday ? { weekday: 'short' as const } : {}),
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function weekdayName(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}

function weekLabelFor(mondayISO: string): string {
  const end = addDaysISO(mondayISO, 6);
  return `${dayLabel(mondayISO)} to ${dayLabel(end)}, ${mondayISO.slice(0, 4)}`;
}

// --- plan math ----------------------------------------------------------------

export function serviceTypeFor(frequencyWeeks: number): ServiceType | 'Monthly' {
  if (frequencyWeeks === 2) return 'Bi-Weekly';
  if (frequencyWeeks >= 4) return 'Monthly';
  return 'Weekly';
}

// "week" / "2 weeks", for sentences like "$20 per week".
export function cadenceLabel(frequencyWeeks: number): string {
  return frequencyWeeks === 1 ? 'week' : `${frequencyWeeks} weeks`;
}

// What the offer comes to at the current numbers. The form seeds the signup
// total with this and lets it be overridden, so a rounded deal ($60 on a $19
// price) still records exactly what was collected.
export function suggestedSignupTotal(plan: SignupPlan): number {
  const paid = Math.max(0, plan.covered_visits - plan.free_visits);
  return round2(plan.price_per_visit * paid);
}

// Split a collected amount evenly across the paid weeks, giving the remainder
// to the last one so the parts always add back up to the whole.
function splitEvenly(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const each = Math.floor((total / parts) * 100) / 100;
  const out = Array(parts).fill(each) as number[];
  out[parts - 1] = round2(total - each * (parts - 1));
  return out;
}

// The visits the signup payment buys, with the billing week each one lands in
// and the dollars credited to it. Free visits come first and are credited $0,
// which is what keeps them out of revenue while still blocking the auto-charge
// for that week.
export function coveredVisits(firstVisitISO: string, plan: SignupPlan): CoveredVisit[] {
  const freq = plan.frequency_weeks > 0 ? plan.frequency_weeks : 1;
  const free = Math.min(Math.max(0, plan.free_visits), plan.covered_visits);
  const amounts = splitEvenly(plan.signup_total, plan.covered_visits - free);

  const out: CoveredVisit[] = [];
  for (let i = 0; i < plan.covered_visits; i++) {
    const visitDate = addDaysISO(firstVisitISO, i * freq * 7);
    const periodStart = mondayOfISO(visitDate);
    out.push({
      visitDate,
      periodStart,
      periodEnd: addDaysISO(periodStart, 6),
      weekLabel: weekLabelFor(periodStart),
      amount: i < free ? 0 : amounts[i - free] ?? 0,
      free: i < free,
    });
  }
  return out;
}

// First visit the client pays for normally, the day the standing auto-charge
// takes over. With nothing prepaid that is the first visit itself.
export function firstChargedVisit(firstVisitISO: string, plan: SignupPlan): string {
  const freq = plan.frequency_weeks > 0 ? plan.frequency_weeks : 1;
  return addDaysISO(firstVisitISO, Math.max(0, plan.covered_visits) * freq * 7);
}
