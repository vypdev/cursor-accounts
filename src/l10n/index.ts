import * as fs from 'fs';
import * as path from 'path';

export type LocaleMessages = Record<string, string>;

const SUPPORTED_LOCALES = [
  'en',
  'es',
  'fr',
  'pt-br',
  'pt',
  'zh',
  'zh-tw',
  'ja',
  'de',
  'it',
  'ko',
  'ru',
  'nl',
  'pl',
  'tr',
  'id',
  'vi',
  'uk',
  'cs',
  'sv',
  'nb',
  'da',
  'ar',
  'hi',
  'th',
  'he',
] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const RTL_LOCALES = new Set<SupportedLocale>(['ar', 'he']);

let activeLocale: SupportedLocale = 'en';
let activeMessages: LocaleMessages = {};
let fallbackMessages: LocaleMessages = {};

function isSupportedLocale(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

export function resolveLocale(language: string): SupportedLocale {
  const normalized = language.toLowerCase();
  if (normalized.startsWith('pt-br')) {
    return 'pt-br';
  }
  if (normalized.startsWith('pt')) {
    return 'pt';
  }
  if (normalized.startsWith('zh-tw') || normalized.startsWith('zh-hant')) {
    return 'zh-tw';
  }
  if (normalized.startsWith('zh')) {
    return 'zh';
  }
  const base = normalized.split('-')[0] ?? 'en';
  return isSupportedLocale(base) ? base : 'en';
}

export function isRtlLocale(locale: SupportedLocale = activeLocale): boolean {
  return RTL_LOCALES.has(locale);
}

function loadBundleFromDisk(
  extensionPath: string,
  locale: SupportedLocale
): LocaleMessages {
  const filePath = path.join(extensionPath, 'locales', `${locale}.json`);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as LocaleMessages;
}

export function initL10n(options: {
  extensionPath: string;
  language: string;
}): void {
  const locale = resolveLocale(options.language);
  fallbackMessages = loadBundleFromDisk(options.extensionPath, 'en');
  activeMessages =
    locale === 'en'
      ? fallbackMessages
      : loadBundleFromDisk(options.extensionPath, locale);
  activeLocale = locale;
}

/** Test helper: initialize l10n from an in-memory bundle. */
export function initL10nForTests(
  messages: LocaleMessages,
  locale: SupportedLocale = 'en',
  fallback?: LocaleMessages
): void {
  activeMessages = messages;
  fallbackMessages = fallback ?? messages;
  activeLocale = locale;
}

export function getLocale(): SupportedLocale {
  return activeLocale;
}

export function getWebviewMessages(): LocaleMessages {
  return Object.fromEntries(
    Object.entries(activeMessages)
      .filter(([key]) => key.startsWith('webview.'))
      .map(([key, value]) => [key.slice('webview.'.length), value])
  );
}

export function t(
  key: string,
  args?: Record<string, string | number | undefined>
): string {
  let message = activeMessages[key] ?? fallbackMessages[key] ?? key;

  if (args) {
    for (const [argKey, value] of Object.entries(args)) {
      if (value === undefined) {
        continue;
      }
      message = message.replace(
        new RegExp(`\\{${argKey}\\}`, 'g'),
        String(value)
      );
    }
  }

  return message;
}
