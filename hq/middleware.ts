import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Refreshes the Supabase session cookie and gates staff routes.
// Everything not listed here, including the staff data APIs under /api, requires
// an authenticated session. The exempt API routes self-authenticate by other means
// (CRON_SECRET, Stripe webhook signature, or a per-customer/quote token), so they're
// listed explicitly rather than blanket-exempting all of /api.
const PUBLIC_PREFIXES = [
  '/login',
  '/quote/', // public quote approval page
  '/my-account', // customer portal page
  '/api/portal', // portal lookup + skip (token-gated in handler)
  '/api/quotes/', // PUBLIC quote-token routes only, NOT the staff /api/quotes list
  '/api/stripe/', // webhook (signature) + setup (token/session self-auth)
  '/api/cron', // daily cron orchestrator (CRON_SECRET)
  '/api/jobs/', // recurring-visit generator (CRON_SECRET)
  '/api/auto-invoice', // invoice cron (CRON_SECRET)
  '/api/automations/run', // automations cron (CRON_SECRET), staff /api/automations stays protected
];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
