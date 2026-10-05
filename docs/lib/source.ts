import { loader } from 'fumadocs-core/source';
import { defineDocs } from 'fumadocs-mdx/macro';
import { handbookPageUrl } from '@/lib/handbook-url';
import { i18n } from '@/lib/i18n';

const docs = defineDocs();

export const source = loader({
  baseUrl: '/',
  url: handbookPageUrl,
  source: docs.toFumadocsSource(),
  i18n,
});
