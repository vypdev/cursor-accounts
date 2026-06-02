/** Format raw membershipType from Cursor API for display. */
export function formatMembershipType(
  membershipType?: string
): string | null {
  if (!membershipType?.trim()) {
    return null;
  }

  return membershipType
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/** Format byte counts for display (e.g. 1536 -> "1.5 KB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** exponent;
  const formatted =
    value >= 100 || exponent === 0
      ? Math.round(value).toString()
      : value.toFixed(1);

  return `${formatted} ${units[exponent]}`;
}
