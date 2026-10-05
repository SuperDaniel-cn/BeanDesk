import { Inter } from 'next/font/google';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './global.css';

const inter = Inter({
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'BeanDesk handbook',
    template: '%s — BeanDesk',
  },
  description: 'A first book, or a Beancount folder you already have.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">{children}</body>
    </html>
  );
}
