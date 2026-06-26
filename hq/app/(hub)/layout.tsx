import { redirect } from 'next/navigation';
import { getCurrentUser, getCurrentTechnician } from '@/lib/auth';
import { NavBar } from '@/components/ui';

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const tech = await getCurrentTechnician();
  const name = tech?.name ?? user.email ?? undefined;

  return (
    <div>
      <NavBar name={name} />
      <main className="max-w-6xl mx-auto px-6 py-7">{children}</main>
    </div>
  );
}
