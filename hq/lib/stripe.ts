// Stripe client + shared helpers. Owned by Workstream 0.
// Workstream 6 (Invoices & payments) owns the charging LOGIC and route handlers;
// this file just exposes a configured client and small helpers everyone can read.

import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function stripe(): Stripe {
  if (typeof window !== 'undefined') {
    throw new Error('stripe() is server-only.');
  }
  if (_stripe) return _stripe;
  _stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2024-06-20',
  });
  return _stripe;
}

export function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}
