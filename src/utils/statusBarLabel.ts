export function appendProfileSuffix(
  base: string,
  name: string | undefined,
  showName: boolean
): string {
  if (!showName || !name) {
    return base;
  }
  return `${base} (${name})`;
}
