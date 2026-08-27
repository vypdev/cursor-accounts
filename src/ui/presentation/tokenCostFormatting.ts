export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}m`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(Math.round(n));
}

export function formatCostUsd(costCents: number, authoritative: boolean): string {
  const costUsd = costCents / 100;
  if (costUsd < 0.01) {
    return '<$0.01';
  }
  const label = `$${costUsd.toFixed(2)}`;
  return authoritative ? label : `~${label}`;
}
