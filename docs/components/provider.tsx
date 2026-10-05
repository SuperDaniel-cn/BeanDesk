'use client';

import { i18nProvider } from 'fumadocs-ui/i18n';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { type ReactNode } from 'react';
import { translations } from '@/lib/i18n';

export function Provider({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  return (
    <RootProvider i18n={i18nProvider(translations, locale)} search={{ enabled: false }}>
      {children}
    </RootProvider>
  );
}
