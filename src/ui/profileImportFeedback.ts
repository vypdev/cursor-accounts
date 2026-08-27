import type { ToWebviewMessage } from '@cursor-accounts/types';
import type { ImportResult } from '../profiles/types';

export type ProfileImportTranslator = (
  key: string,
  args?: Record<string, string | number | undefined>
) => string;

export interface ProfileImportFeedback {
  shouldRefresh: boolean;
  message: Extract<ToWebviewMessage, { type: 'success' | 'error' }>;
}

/** Builds localized panel feedback without performing UI or import side effects. */
export function buildProfileImportFeedback(
  result: ImportResult,
  translate: ProfileImportTranslator
): ProfileImportFeedback {
  const messages: string[] = [];
  if (result.imported.length > 0) {
    messages.push(translate('panel.imported', { count: result.imported.length }));
  }
  if (result.skipped.length > 0) {
    messages.push(translate('panel.importSkipped', { count: result.skipped.length }));
  }
  if (result.errors.length > 0) {
    messages.push(translate('panel.importErrors', { count: result.errors.length }));
  }

  const success = result.success;
  return {
    shouldRefresh: result.imported.length > 0 || result.skipped.length > 0,
    message: {
      type: success ? 'success' : 'error',
      message:
        messages.join(', ') ||
        translate(
          success
            ? 'panel.importCompleted'
            : 'panel.importCompletedWithErrors'
        ),
    },
  };
}
