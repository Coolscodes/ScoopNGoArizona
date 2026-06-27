// Workstream 7 — shared portal data types + token resolver.
// Lives outside the route file because Next.js only allows route-handler exports
// (GET/POST/etc.) from a `route.ts`. Imported by the route, the skip route, and
// the my-account server page.

import { supabaseServer } from '@/lib/supabase';
import type { Customer } from '@/lib/types';

// Only fields safe to expose to the customer's own browser. We deliberately DROP
// `portal_token` and `stripe_customer_id` (a derived boolean is exposed for
// card-on-file) so neither secret ever reaches the client.
export interface PortalCustomer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  zip?: string;
  service_type?: string;
  preferred_day?: string;
  price_per_visit?: number;
  frequency_weeks?: number;
  next_visit_date?: string;
  active: boolean;
  has_card_on_file: boolean;
}

export interface PortalLastVisit {
  completed_at: string;
  gate_photo_url?: string;
}

export interface PortalInvoice {
  id: string;
  amount: number;
  status: string;
  due_date?: string;
  period_start?: string;
  period_end?: string;
}

export interface PortalData {
  customer: PortalCustomer;
  nextVisit: { scheduled_at: string; service_type?: string } | null;
  lastVisit: PortalLastVisit | null;
  balance: number;
  invoices: PortalInvoice[];
}

export function toPortalCustomer(c: Customer): PortalCustomer {
  return {
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    email: c.email,
    phone: c.phone,
    address: c.address,
    city: c.city,
    zip: c.zip,
    service_type: c.service_type,
    preferred_day: c.preferred_day,
    price_per_visit: c.price_per_visit,
    frequency_weeks: c.frequency_weeks,
    next_visit_date: c.next_visit_date,
    active: c.active,
    has_card_on_file: Boolean(c.stripe_customer_id),
  };
}

// Resolve a token to the owning customer, or null. Returns the FULL row
// (server-side only) so callers can read service-role-only fields; never return
// this raw to the browser.
export async function customerForToken(token: string): Promise<Customer | null> {
  const t = token.trim();
  if (!t) return null;
  const { data, error } = await supabaseServer()
    .from('customers')
    .select('*')
    .eq('portal_token', t)
    .maybeSingle();
  if (error || !data) return null;
  return data as Customer;
}
