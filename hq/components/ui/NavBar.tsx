'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';
import { cn } from './utils';

// Full staff navigation. Foundation owns this; feature workstreams fill in the routes.
const NAV = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Route', href: '/route' },
  { label: 'Clients', href: '/clients' },
  { label: 'Leads', href: '/leads' },
  { label: 'Quotes', href: '/quotes' },
  { label: 'Invoices', href: '/invoices' },
  { label: 'Automations', href: '/automations' },
];

export function NavBar({ name }: { name?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40">
      <div className="bg-brand-dark text-white h-[60px] px-6 flex items-center justify-between">
        <span className="font-heading font-black text-[1.1rem]">Scoop N Go HQ</span>
        <div className="flex items-center gap-4">
          {name && <span className="text-sm text-white/80 hidden sm:inline">{name}</span>}
          <button
            onClick={signOut}
            className="bg-white/15 border border-white/30 text-white px-3 py-1.5 rounded-md text-[0.82rem] font-heading font-bold hover:bg-white/25"
          >
            Log out
          </button>
        </div>
      </div>
      <nav className="bg-white border-b-2 border-line px-6 flex overflow-x-auto">
        {NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'px-5 py-4 font-heading text-[0.88rem] font-bold whitespace-nowrap border-b-[3px] -mb-0.5 transition-colors',
                active
                  ? 'text-brand-dark border-brand-dark'
                  : 'text-muted border-transparent hover:text-brand'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
