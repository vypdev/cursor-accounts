import React, { useRef, useState } from 'react';
import { useL10n } from '../l10n/context';
import type { ImportOptions } from '../types';

interface ImportDialogProps {
  onImport: (json: string, options: ImportOptions) => void;
  onCancel: () => void;
}

export const ImportDialog: React.FC<ImportDialogProps> = ({
  onImport,
  onCancel,
}) => {
  const { t } = useL10n();
  const [file, setFile] = useState<File | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [importSettings, setImportSettings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) {
      return;
    }

    try {
      const text = await file.text();

      onImport(text, {
        skipDuplicates,
        overwriteExisting: !skipDuplicates,
        importSettings,
        strictValidation: true,
      });
    } catch (error) {
      console.error('Failed to read file:', error);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel} role="presentation">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="import-profiles-title"
      >
        <div className="modal-header">
          <h3 id="import-profiles-title">{t('import.title')}</h3>
          <button
            type="button"
            className="btn-close"
            onClick={onCancel}
            aria-label={t('addProfile.close')}
          >
            ×
          </button>
        </div>

        <form
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
        >
          <div className="form-group">
            <label htmlFor="import-file">{t('import.fileLabel')}</label>
            <input
              ref={fileInputRef}
              id="import-file"
              type="file"
              accept=".json,application/json"
              onChange={handleFileChange}
            />
            {file && <span className="file-name">{file.name}</span>}
          </div>

          <div className="form-group checkbox">
            <label>
              <input
                type="checkbox"
                checked={skipDuplicates}
                onChange={(e) => setSkipDuplicates(e.target.checked)}
              />
              {t('import.skipDuplicates')}
            </label>
          </div>

          <div className="form-group checkbox">
            <label>
              <input
                type="checkbox"
                checked={importSettings}
                onChange={(e) => setImportSettings(e.target.checked)}
              />
              {t('import.importSettings')}
            </label>
          </div>

          <div className="form-actions">
            <button type="button" onClick={onCancel}>
              {t('import.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={!file}>
              {t('import.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
