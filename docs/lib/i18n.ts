import { defineI18n } from 'fumadocs-core/i18n';
import { uiTranslations } from 'fumadocs-ui/i18n';

export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'zh-CN'],
  hideLocale: 'default-locale',
});

export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add({
    en: {
      displayName: 'English',
    },
    'zh-CN': {
      displayName: '简体中文',
      'Language(language switcher)': '语言',
      'Choose a language(language switcher)': '选择语言',
      'Choose a language(language switcher)(aria-label)': '选择语言',
      'On this page(table of contents)': '本页目录',
      'Next Page(pagination)': '下一页',
      'Previous Page(pagination)': '上一页',
      'No Headings(table of contents)': '本页无标题',
      'Hide Sidebar(sidebar)': '隐藏侧栏',
      'Show Sidebar(sidebar)': '显示侧栏',
      'Theme(site menu)': '主题',
    },
  });
