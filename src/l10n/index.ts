import * as fs from 'fs';
import * as path from 'path';

export type LocaleMessages = Record<string, string>;

const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

let activeLocale: SupportedLocale = 'en';
let activeMessages: LocaleMessages = {};
let fallbackMessages: LocaleMessages = {};

function isSupportedLocale(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

export function resolveLocale(language: string): SupportedLocale {
  const base = language.split('-')[0]?.toLowerCase() ?? 'en';
  return isSupportedLocale(base) ? base : 'en';
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

export function getMessages(): LocaleMessages {
  return { ...activeMessages };
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
