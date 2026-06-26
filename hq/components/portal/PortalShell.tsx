import type { ReactNode } from 'react';

// Lightweight branded shell for the public customer portal. It deliberately does
// NOT use the staff (hub) layout — customers never see staff nav. Pure
// presentational wrapper.
export function PortalShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-tan">
      <header className="bg-brand-dark text-white">
        <div className="max-w-2xl mx-auto px-5 py-4">
          <div className="font-heading text-lg font-black tracking-tight">Scoop N Go</div>
          <div className="font-heading text-[0.78rem] font-bold text-white/70">My Account</div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-5 py-6">{children}</main>
      <footer className="max-w-2xl mx-auto px-5 py-6 text-center text-xs text-muted">
        Scoop N Go Arizona · Questions? Reply to your reminder text or email us.
      </footer>
    </div>
  );
}
