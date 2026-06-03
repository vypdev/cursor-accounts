import React from 'react';
import type { ProxyStatus } from '../types';
import { useL10n } from '../l10n/context';

export interface ProxyStatusCardProps {
  proxyStatus: ProxyStatus | null;
  currentWindowUsesProxy: boolean;
  onStartProxy: () => void;
  onStopProxy: () => void;
  onShowLogs: () => void;
  onShowCertificate: () => void;
  onSaveCertificate: () => void;
}

export const ProxyStatusCard: React.FC<ProxyStatusCardProps> = ({
  proxyStatus,
  currentWindowUsesProxy,
  onStartProxy,
  onStopProxy,
  onShowLogs,
  onShowCertificate,
  onSaveCertificate,
}) => {
  const { t } = useL10n();
  const isRunning = proxyStatus?.running ?? false;
  const certInstalled = proxyStatus?.caCertificateInstalled === true;

  return (
    <section className="proxy-status-card" aria-label={t('proxy.title')}>
      <div className="proxy-status-header">
        <h3>{t('proxy.title')}</h3>
        <div className="proxy-status-badges">
          <span
            className={`proxy-status-indicator ${isRunning ? 'running' : 'stopped'}`}
          >
            {isRunning ? t('proxy.running') : t('proxy.stopped')}
          </span>
          <span
            className={`proxy-status-indicator ${
              certInstalled ? 'installed' : 'not-installed'
            }`}
          >
            {certInstalled
              ? t('proxy.certInstalled')
              : t('proxy.certNotInstalled')}
          </span>
        </div>
      </div>

      {isRunning && (
        <div className="proxy-status-details">
          {proxyStatus?.port != null && (
            <p>
              <span className="proxy-label">{t('proxy.port')}:</span>{' '}
              <span className="proxy-value">{proxyStatus.port}</span>
            </p>
          )}
          <p>
            <span className="proxy-label">{t('proxy.thisWindow')}:</span>{' '}
            <span
              className={
                currentWindowUsesProxy
                  ? 'proxy-window-connected'
                  : 'proxy-window-bypassed'
              }
            >
              {currentWindowUsesProxy
                ? t('proxy.usingProxy')
                : t('proxy.notUsingProxy')}
            </span>
          </p>
          {proxyStatus?.statistics && (
            <p>
              <span className="proxy-label">{t('proxy.requests')}:</span>{' '}
              <span className="proxy-value">
                {proxyStatus.statistics.totalRequests} (
                {proxyStatus.statistics.cursorRequests} Cursor)
              </span>
            </p>
          )}
        </div>
      )}

      <div className="proxy-status-actions">
        {isRunning ? (
          <>
            <button type="button" className="btn-secondary" onClick={onStopProxy}>
              {t('proxy.stop')}
            </button>
            <button type="button" className="btn-secondary" onClick={onShowLogs}>
              {t('proxy.viewLogs')}
            </button>
          </>
        ) : (
          <button type="button" className="btn-primary" onClick={onStartProxy}>
            {t('proxy.start')}
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          onClick={onSaveCertificate}
        >
          {t('proxy.downloadCa')}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={onShowCertificate}
        >
          {t('proxy.caCertificate')}
        </button>
      </div>

      {isRunning && !currentWindowUsesProxy && (
        <p className="proxy-status-notice">{t('proxy.noticeRelaunch')}</p>
      )}
    </section>
  );
};
