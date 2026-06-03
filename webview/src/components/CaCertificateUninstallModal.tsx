import React from 'react';
import { useL10n } from '../l10n/context';

export interface CaCertificateUninstallModalProps {
  inProgress: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const CaCertificateUninstallModal: React.FC<
  CaCertificateUninstallModalProps
> = ({ inProgress, onConfirm, onCancel }) => {
  const { t } = useL10n();

  return (
    <div className="modal-overlay" onClick={onCancel} role="presentation">
      <div
        className="modal cert-uninstall-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cert-uninstall-title"
      >
        <div className="modal-header">
          <h3 id="cert-uninstall-title">{t('proxy.uninstall.confirmTitle')}</h3>
          <button
            type="button"
            className="btn-close"
            onClick={onCancel}
            disabled={inProgress}
            aria-label={t('proxy.uninstall.cancel')}
          >
            ×
          </button>
        </div>

        <div className="cert-uninstall-modal-body">
          <p>{t('proxy.uninstall.confirmBody')}</p>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={inProgress}
          >
            {t('proxy.uninstall.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={inProgress}
          >
            {inProgress
              ? t('proxy.uninstall.inProgress')
              : t('proxy.uninstall.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};
