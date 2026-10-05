import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { handbookPageUrl } from '@/lib/handbook-url';

export function baseOptions(locale: string): BaseLayoutProps {
  return {
    nav: {
      title: 'BeanDesk',
      url: handbookPageUrl([], locale),
    },
  };
}
