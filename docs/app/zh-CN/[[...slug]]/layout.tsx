import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DocumentLang } from '@/components/document-lang';
import { Provider } from '@/components/provider';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';

const locale = 'zh-CN';

export const metadata: Metadata = {
  title: {
    default: '经营账本手册',
    template: '%s — 经营账本',
  },
  description: '一人公司对公财税与合规工作台。',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <Provider locale={locale}>
      <DocumentLang locale={locale} />
      <DocsLayout
        tree={source.getPageTree(locale)}
        containerProps={{ className: 'desktop-docs-layout' }}
        sidebar={{ defaultOpenLevel: 2 }}
        {...baseOptions(locale)}
      >
        {children}
      </DocsLayout>
    </Provider>
  );
}
