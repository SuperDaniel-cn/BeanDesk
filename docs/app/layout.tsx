import { Inter } from 'next/font/google';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { HANDBOOK_THEME_BOOT } from '@/lib/theme-boot';
import './global.css';

const inter = Inter({
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'BeanDesk handbook',
    template: '%s — BeanDesk',
  },
  description: 'Local-first double-entry workbench for one-person companies and private management accounting.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: HANDBOOK_THEME_BOOT }} />
      </head>
      <body className="flex min-h-screen flex-col">{children}</body>
    </html>
  );
}
