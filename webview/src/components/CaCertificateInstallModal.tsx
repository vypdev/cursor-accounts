import React, { useCallback, useState } from 'react';
import type { ProxyInstallGuide } from '../types';
import { useL10n } from '../l10n/context';

export interface CaCertificateInstallModalProps {
  guide: ProxyInstallGuide | null;
  loading: boolean;
  installInProgress: boolean;
  onClose: () => void;
  onSaveCertificate: () => void;
  onInstallCertificate: () => void;
}

export const CaCertificateInstallModal: React.FC<CaCertificateInstallModalProps> = ({
  guide,
  loading,
  installInProgress,
  onClose,
  onSaveCertificate,
  onInstallCertificate,
}) => {
  const { t } = useL10n();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = useCallback(async (code: string, index: number) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // clipboard may be unavailable in some webview contexts
    }
  }, []);

  const title = guide?.title ?? t('proxy.install.title');
  const intro = guide?.intro ?? '';

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal cert-install-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cert-install-title"
      >
        <div className="modal-header">
          <h3 id="cert-install-title">{title}</h3>
          <button
            type="button"
            className="btn-close"
            onClick={onClose}
            aria-label={t('proxy.install.close')}
          >
            ×
          </button>
        </div>

        <div className="cert-install-modal-body">
          {loading && (
            <p className="cert-install-loading">{t('proxy.install.loading')}</p>
          )}

          {!loading && guide && (
            <>
              <p className="cert-install-intro">{intro}</p>

              {!guide.certAvailable && guide.certNotReady && (
                <p className="cert-install-warning" role="alert">
                  {guide.certNotReady}
                </p>
              )}

              <ol className="cert-install-steps">
                {guide.steps.map((step, index) => (
                  <li key={`${step.kind}-${index}`} className="cert-install-step">
                    <div className="cert-install-step-header">
                      <span className="cert-install-step-number" aria-hidden="true">
                        {index + 1}
                      </span>
                      <div className="cert-install-step-content">
                        <h4 className="cert-install-step-title">{step.title}</h4>
                        {step.body && (
                          <p className="cert-install-step-body">{step.body}</p>
                        )}

                        {step.kind === 'install' && (
                          <div className="cert-install-install-card">
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={!guide.certAvailable || installInProgress}
                              onClick={onInstallCertificate}
                            >
                              {installInProgress
                                ? t('proxy.install.installInProgress')
                                : step.title}
                            </button>
                          </div>
                        )}

                        {step.kind === 'download' && (
                          <div className="cert-install-download-card">
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={onSaveCertificate}
                            >
                              {t('proxy.downloadCa')}
                            </button>
                          </div>
                        )}

                        {step.kind === 'code' && step.code && (
                          <div className="cert-install-code-block">
                            <pre>{step.code}</pre>
                            <button
                              type="button"
                              className="btn-secondary cert-install-copy-btn"
                              onClick={() => {
                                void handleCopy(step.code!, index);
                              }}
                            >
                              {copiedIndex === index
                                ? t('proxy.install.copied')
                                : t('proxy.install.copyCode')}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t('proxy.install.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
