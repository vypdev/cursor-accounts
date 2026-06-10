import React from 'react';
import type { MultiplexerStatusView, ProxyStatus } from '../types';
import { useL10n } from '../l10n/context';

export interface ProxyStatusCardUnifiedProps {
  multiplexerStatus: MultiplexerStatusView;
  proxyStatus: ProxyStatus | null;
  uninstallInProgress?: boolean;
  onShowLogs: () => void;
  onShowTraffic: () => void;
  onShowCertificate: () => void;
  onSaveCertificate: () => void;
  onDeleteCertificate?: () => void;
}

export const ProxyStatusCardUnified: React.FC<ProxyStatusCardUnifiedProps> = ({
  multiplexerStatus,
  proxyStatus,
  uninstallInProgress = false,
  onShowLogs,
  onShowTraffic,
  onShowCertificate,
  onSaveCertificate,
  onDeleteCertificate,
}) => {
  const { t } = useL10n();
  const routerRunning = multiplexerStatus.running;
  const certInstalled = proxyStatus?.caCertificateInstalled === true;

  return (
    <section
      className="proxy-status-card multiplexer-status-card"
      aria-label={t('proxy.title')}
    >
      <div className="proxy-status-header">
        <h3>{t('proxy.title')}</h3>
        <div className="proxy-status-badges">
          <span
            className={`proxy-status-indicator ${routerRunning ? 'running' : 'stopped'}`}
          >
            {routerRunning ? t('multiplexer.running') : t('multiplexer.stopped')}
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

      {routerRunning && (
        <div className="proxy-status-details">
          {multiplexerStatus.port != null && (
            <p>
              <span className="proxy-label">{t('multiplexer.port')}:</span>{' '}
              <span className="proxy-value">{multiplexerStatus.port}</span>
            </p>
          )}
          {multiplexerStatus.strategy && (
            <p>
              <span className="proxy-label">{t('multiplexer.strategy')}:</span>{' '}
              <span className="proxy-value">{multiplexerStatus.strategy}</span>
            </p>
          )}
          <p>
            <span className="proxy-label">{t('multiplexer.sessions')}:</span>{' '}
            <span className="proxy-value">{multiplexerStatus.activeSessions}</span>
          </p>
        </div>
      )}

      {multiplexerStatus.upstreams.length > 0 && (
        <div className="multiplexer-upstreams">
          <h4>{t('multiplexer.upstreams')}</h4>
          <ul>
            {multiplexerStatus.upstreams.map((upstream) => (
              <li key={upstream.id}>
                <span className="proxy-value">
                  {upstream.id} ({upstream.host}:{upstream.port})
                </span>{' '}
                <span
                  className={
                    upstream.healthy
                      ? 'proxy-window-connected'
                      : 'proxy-window-bypassed'
                  }
                >
                  {upstream.healthy
                    ? t('multiplexer.healthy')
                    : t('multiplexer.unhealthy')}
                </span>{' '}
                <span className="proxy-label">
                  {upstream.requests} req / {upstream.activeConnections} conn
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="proxy-status-actions">
        <button type="button" className="btn-secondary" onClick={onShowLogs}>
          {t('proxy.viewLogs')}
        </button>
        <button type="button" className="btn-secondary" onClick={onShowTraffic}>
          {t('proxy.viewTraffic')}
        </button>
        {!certInstalled && (
          <>
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
          </>
        )}
        {certInstalled && onDeleteCertificate && (
          <button
            type="button"
            className="btn-secondary"
            onClick={onDeleteCertificate}
            disabled={uninstallInProgress}
            title={t('proxy.deleteCertificateTitle')}
          >
            {uninstallInProgress
              ? t('proxy.uninstall.inProgress')
              : t('proxy.deleteCertificate')}
          </button>
        )}
      </div>
    </section>
  );
};
