/**
 * Render a compact Unicode progress bar for the status bar.
 */
export function renderProgressBar(percent: number, width = 8): string {
  const clamped = clampPercent(percent);
  const filled = Math.round((clamped / 100) * width);
  return '▓'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function formatPercent(value: number): string {
  const clamped = clampPercent(value);
  return `${clamped}%`;
}

/** Convert cents to a dollar string (e.g. 23222 -> "$232.22"). */
export function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) {
    return '$0.00';
  }
  return `$${(cents / 100).toFixed(2)}`;
}

/** Parse ms timestamp strings from Cursor API responses. */
export function formatBillingDate(msString: string | undefined): string {
  if (!msString) {
    return '—';
  }
  const ms = Number(msString);
  if (!Number.isFinite(ms)) {
    return '—';
  }
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
