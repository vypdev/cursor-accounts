/** Build the default human-readable profile name from an email address. */
export function generateProfileDisplayName(email: string): string {
  const localPart = email.split('@')[0] ?? email;
  return localPart
    .replace(/[._]/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
