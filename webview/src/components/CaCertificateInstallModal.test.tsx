import { fireEvent, render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { L10nProvider } from '../l10n/context';
import type { ProxyInstallGuide } from '../types';
import { CaCertificateInstallModal } from './CaCertificateInstallModal';

const guide: ProxyInstallGuide = {
  platform: 'darwin',
  certAvailable: true,
  title: 'Install the local certificate',
  intro: 'Trust the certificate before starting the proxy.',
  steps: [
    { kind: 'text', title: 'Open Keychain Access', body: 'Use the system utility.' },
    { kind: 'download', title: 'Download the certificate' },
    { kind: 'code', title: 'Run this command', code: 'security add-trusted-cert ca.pem' },
    { kind: 'install', title: 'Install automatically' },
  ],
};

function renderModal(
  overrides: Partial<ComponentProps<typeof CaCertificateInstallModal>> = {}
): void {
  render(
    <L10nProvider locale="en" messages={{}}>
      <CaCertificateInstallModal
        guide={guide}
        loading={false}
        installInProgress={false}
        onClose={vi.fn()}
        onSaveCertificate={vi.fn()}
        onInstallCertificate={vi.fn()}
        {...overrides}
      />
    </L10nProvider>
  );
}

describe('CaCertificateInstallModal', () => {
  it('renders the loading state and fallback title without a guide', () => {
    renderModal({ guide: null, loading: true });

    expect(screen.getByRole('dialog', { name: 'proxy.install.title' })).toBeInTheDocument();
    expect(screen.getByText('proxy.install.loading')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('renders warnings, instructions, download, and install states', () => {
    const onSaveCertificate = vi.fn();
    const onInstallCertificate = vi.fn();
    const unavailableGuide = {
      ...guide,
      certAvailable: false,
      certNotReady: 'The certificate is not ready yet.',
    };

    renderModal({
      guide: unavailableGuide,
      onSaveCertificate,
      onInstallCertificate,
    });

    expect(screen.getByRole('heading', { name: guide.title })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The certificate is not ready yet.');
    expect(screen.getByText('Open Keychain Access')).toBeInTheDocument();
    expect(screen.getByText('security add-trusted-cert ca.pem')).toBeInTheDocument();

    const downloadButton = screen.getByRole('button', { name: 'proxy.downloadCa' });
    fireEvent.click(downloadButton);
    expect(onSaveCertificate).toHaveBeenCalledOnce();

    const installButton = screen.getByRole('button', { name: 'Install automatically' });
    expect(installButton).toBeDisabled();
    expect(onInstallCertificate).not.toHaveBeenCalled();
  });

  it('invokes installation and shows progress when the certificate is available', () => {
    const onInstallCertificate = vi.fn();
    renderModal({ onInstallCertificate, installInProgress: false });

    const installButton = screen.getByRole('button', { name: 'Install automatically' });
    expect(installButton).toBeEnabled();
    fireEvent.click(installButton);
    expect(onInstallCertificate).toHaveBeenCalledOnce();

    renderModal({ installInProgress: true });
    expect(screen.getByRole('button', { name: 'proxy.install.installInProgress' })).toBeDisabled();
  });

  it('copies code, clears the copied state, tolerates clipboard failure, and closes', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByRole('button', { name: 'proxy.install.copyCode' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith('security add-trusted-cert ca.pem');
    expect(screen.getByRole('button', { name: 'proxy.install.copied' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'proxy.install.copyCode' })).toBeInTheDocument();

    writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'proxy.install.copyCode' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'proxy.install.copyCode' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
