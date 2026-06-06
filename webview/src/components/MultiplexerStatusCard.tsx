import React from 'react';
import type { MultiplexerRoutingStrategy, MultiplexerStatusView } from '../types';
import { useL10n } from '../l10n/context';

export interface MultiplexerStatusCardProps {
  status: MultiplexerStatusView | null;
  onStart: () => void;
  onStop: () => void;
  onRefresh: () => void;
  onSetStrategy: (strategy: MultiplexerRoutingStrategy) => void;
}

const STRATEGIES: Array<{ value: MultiplexerRoutingStrategy; label: string }> = [
  { value: 'sticky-session', label: 'Sticky Session' },
  { value: 'token-hash', label: 'Token Hash' },
  { value: 'round-robin', label: 'Round Robin' },
  { value: 'least-connections', label: 'Least Connections' },
  { value: 'workspace-path', label: 'Workspace Path' },
  { value: 'hybrid', label: 'Hybrid' },
];

export const MultiplexerStatusCard: React.FC<MultiplexerStatusCardProps> = ({
  status,
  onStart,
  onStop,
  onRefresh,
  onSetStrategy,
}) => {
  const { t } = useL10n();
  if (!status) {
    return null;
  }

  const isRunning = status.running;

  return (
    <section className="proxy-status-card multiplexer-status-card" aria-label={t('multiplexer.title')}>
      <div className="proxy-status-header">
        <h3>{t('multiplexer.title')}</h3>
        <span className={`proxy-status-indicator ${isRunning ? 'running' : 'stopped'}`}>
          {isRunning ? t('multiplexer.running') : t('multiplexer.stopped')}
        </span>
      </div>

      {isRunning && (
        <div className="proxy-status-details">
          {status.port != null && (
            <p>
              <span className="proxy-label">{t('multiplexer.port')}:</span>{' '}
              <span className="proxy-value">{status.port}</span>
            </p>
          )}
          {status.strategy && (
            <p>
              <span className="proxy-label">{t('multiplexer.strategy')}:</span>{' '}
              <span className="proxy-value">{status.strategy}</span>
            </p>
          )}
          <p>
            <span className="proxy-label">{t('multiplexer.sessions')}:</span>{' '}
            <span className="proxy-value">{status.activeSessions}</span>
          </p>
        </div>
      )}

      {status.upstreams.length > 0 && (
        <div className="multiplexer-upstreams">
          <h4>{t('multiplexer.upstreams')}</h4>
          <ul>
            {status.upstreams.map((upstream) => (
              <li key={upstream.id}>
                <span className="proxy-value">
                  {upstream.id} ({upstream.host}:{upstream.port})
                </span>{' '}
                <span className={upstream.healthy ? 'proxy-window-connected' : 'proxy-window-bypassed'}>
                  {upstream.healthy ? t('multiplexer.healthy') : t('multiplexer.unhealthy')}
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
        {isRunning ? (
          <button type="button" className="btn-secondary" onClick={onStop}>
            {t('multiplexer.stop')}
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={onStart}>
            {t('multiplexer.start')}
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={onRefresh}>
          {t('multiplexer.refresh')}
        </button>
        <select
          className="btn-secondary"
          value={status.strategy ?? 'sticky-session'}
          onChange={(event) =>
            onSetStrategy(event.target.value as MultiplexerRoutingStrategy)
          }
        >
          {STRATEGIES.map((strategy) => (
            <option key={strategy.value} value={strategy.value}>
              {strategy.label}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
};
