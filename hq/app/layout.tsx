import type { Metadata } from 'next';
import { Montserrat, Open_Sans } from 'next/font/google';
import { ToastProvider } from '@/components/ui';
import './globals.css';

const heading = Montserrat({
  subsets: ['latin'],
  weight: ['700', '800', '900'],
  variable: '--font-heading',
  display: 'swap',
});

const body = Open_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Scoop N Go HQ',
  description: 'Operations hub for Scoop N Go Arizona',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable}`}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
