import { redirect } from 'next/navigation';

// The hub root always lands on the dashboard.
export default function HubHome() {
  redirect('/dashboard');
}
