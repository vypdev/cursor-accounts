import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ImportResult } from '../../profiles/types';
import { buildProfileImportFeedback } from '../../ui/profileImportFeedback';

function result(overrides: Partial<ImportResult> = {}): ImportResult {
  return {
    success: true,
    imported: [],
    skipped: [],
    errors: [],
    ...overrides,
  };
}

function translate(
  key: string,
  args?: Record<string, string | number | undefined>
): string {
  const templates: Record<string, string> = {
    'panel.imported': 'Imported {count}',
    'panel.importSkipped': 'Skipped {count}',
    'panel.importErrors': 'Errors {count}',
    'panel.importCompleted': 'Import completed',
    'panel.importCompletedWithErrors': 'Import completed with errors',
  };
  return (templates[key] ?? key).replace(
    /\{([^}]+)\}/g,
    (_match, name: string) => String(args?.[name] ?? '')
  );
}

describe('buildProfileImportFeedback', () => {
  it('builds successful feedback and refreshes after imported or skipped profiles', () => {
    const feedback = buildProfileImportFeedback(
      result({
        imported: [{} as ImportResult['imported'][number]],
        skipped: [{} as ImportResult['skipped'][number]],
      }),
      translate
    );

    assert.deepEqual(feedback, {
      shouldRefresh: true,
      message: {
        type: 'success',
        message: 'Imported 1, Skipped 1',
      },
    });
  });

  it('builds partial-failure feedback with every available count', () => {
    const feedback = buildProfileImportFeedback(
      result({
        success: false,
        imported: [{} as ImportResult['imported'][number]],
        errors: [
          {
            profile: {} as ImportResult['errors'][number]['profile'],
            error: 'invalid profile',
          },
        ],
      }),
      translate
    );

    assert.deepEqual(feedback, {
      shouldRefresh: true,
      message: {
        type: 'error',
        message: 'Imported 1, Errors 1',
      },
    });
  });

  it('uses completion messages and skips refresh when no profile changed', () => {
    assert.deepEqual(
      buildProfileImportFeedback(result(), translate),
      {
        shouldRefresh: false,
        message: { type: 'success', message: 'Import completed' },
      }
    );
    assert.deepEqual(
      buildProfileImportFeedback(
        result({ success: false, errors: [] }),
        translate
      ),
      {
        shouldRefresh: false,
        message: {
          type: 'error',
          message: 'Import completed with errors',
        },
      }
    );
  });
});
