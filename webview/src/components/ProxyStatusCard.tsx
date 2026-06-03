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

  return (
    <section className="proxy-status-card" aria-label={t('webview.proxy.title')}>
      <div className="proxy-status-header">
        <h3>{t('webview.proxy.title')}</h3>
        <span
          className={`proxy-status-indicator ${isRunning ? 'running' : 'stopped'}`}
        >
          {isRunning ? t('webview.proxy.running') : t('webview.proxy.stopped')}
        </span>
      </div>

      {isRunning && (
        <div className="proxy-status-details">
          {proxyStatus?.port != null && (
            <p>
              <span className="proxy-label">{t('webview.proxy.port')}:</span>{' '}
              <span className="proxy-value">{proxyStatus.port}</span>
            </p>
          )}
          <p>
            <span className="proxy-label">{t('webview.proxy.thisWindow')}:</span>{' '}
            <span
              className={
                currentWindowUsesProxy
                  ? 'proxy-window-connected'
                  : 'proxy-window-bypassed'
              }
            >
              {currentWindowUsesProxy
                ? t('webview.proxy.usingProxy')
                : t('webview.proxy.notUsingProxy')}
            </span>
          </p>
          {proxyStatus?.statistics && (
            <p>
              <span className="proxy-label">{t('webview.proxy.requests')}:</span>{' '}
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
              {t('webview.proxy.stop')}
            </button>
            <button type="button" className="btn-secondary" onClick={onShowLogs}>
              {t('webview.proxy.viewLogs')}
            </button>
          </>
        ) : (
          <button type="button" className="btn-primary" onClick={onStartProxy}>
            {t('webview.proxy.start')}
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          onClick={onSaveCertificate}
        >
          {t('webview.proxy.downloadCa')}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={onShowCertificate}
        >
          {t('webview.proxy.caCertificate')}
        </button>
      </div>

      {isRunning && !currentWindowUsesProxy && (
        <p className="proxy-status-notice">{t('webview.proxy.noticeRelaunch')}</p>
      )}
    </section>
  );
};
