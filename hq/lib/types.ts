// Shared entity types, mirror the Supabase schema.
// Owned by Workstream 0 (Foundation). Do not edit in Workstreams 1-8.

export type LeadStatus = 'new' | 'contacted' | 'converted' | 'lost';
export type ServiceType = 'Weekly' | 'Bi-Weekly' | 'One-Time';
export type ApptStatus = 'scheduled' | 'completed' | 'skipped' | 'cancelled';
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';
export type QuoteStatus = 'draft' | 'sent' | 'approved' | 'declined';
export type TechRole = 'owner' | 'tech';
export type PayMethod = 'cash' | 'venmo' | 'zelle' | 'card' | 'check';

export interface Lead {
  id: string;
  created_at: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  zip: string;
  dogs: string;
  service_type: string;
  notes?: string;
  status: LeadStatus;
}

export interface Customer {
  id: string;
  created_at: string;
  lead_id?: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  address?: string;
  city?: string;
  zip?: string;
  gate_code?: string;
  yard_notes?: string;
  service_type?: ServiceType;
  preferred_day?: string;
  price_per_visit?: number;
  active: boolean;
  stripe_customer_id?: string; // existing
  frequency_weeks?: number; // new: 1 weekly, 2 bi-weekly
  start_date?: string; // new
  next_visit_date?: string; // new (generator)
  portal_token?: string; // new (customer portal)
  route_order?: number; // new: standing position within their day's route
  flags?: string[]; // new: admin flags (e.g. "dog aggressive", "cash only")
}

export interface Dog {
  id: string;
  customer_id: string;
  name: string;
  breed?: string;
  notes?: string;
}

export interface Appointment {
  id: string;
  created_at: string;
  customer_id: string;
  scheduled_at: string;
  service_type?: string;
  status: ApptStatus;
  notes?: string;
  assigned_to?: string; // new -> technicians.id
  route_position?: number; // new
}

export interface ServiceLog {
  id: string;
  created_at: string;
  appointment_id?: string;
  customer_id: string;
  completed_at: string;
  gate_photo_url?: string;
  technician_notes?: string;
  issue_flagged: boolean;
  issue_details?: string;
  completed_by?: string; // new -> technicians.id
}

export interface Invoice {
  id: string;
  created_at: string;
  customer_id: string;
  period_start?: string;
  period_end?: string;
  amount: number;
  status: InvoiceStatus;
  due_date?: string;
  notes?: string;
  stripe_payment_intent_id?: string; // existing
}

export interface Payment {
  id: string;
  created_at: string;
  invoice_id: string;
  amount: number;
  method?: PayMethod;
  paid_at: string;
  notes?: string;
}

export interface Technician {
  id: string;
  created_at: string;
  name: string;
  email?: string;
  phone?: string;
  role: TechRole;
  auth_user_id?: string;
  active: boolean;
  color?: string;
}

export interface QuoteLineItem {
  label: string;
  amount: number;
  recurring?: boolean;
}

export interface Quote {
  id: string;
  created_at: string;
  lead_id?: string;
  customer_id?: string;
  line_items: QuoteLineItem[];
  subtotal: number;
  recurring_amount?: number;
  recurring_interval?: string;
  status: QuoteStatus;
  public_token: string;
  approved_at?: string;
  notes?: string;
}

export interface Notification {
  id: string;
  created_at: string;
  customer_id: string;
  type: string;
  channel: 'sms' | 'email';
  message?: string;
  sent_at: string;
  status?: string;
  appointment_id?: string;
}

export interface Automation {
  id: string;
  key: string;
  label: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}
