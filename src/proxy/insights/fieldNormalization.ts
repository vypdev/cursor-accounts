/** Convert numeric protocol fields without allowing non-finite values through. */
export function asNumber(value: unknown): number | undefined {
  if (value == null) {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Read a protocol field that may use either snake_case or camelCase. */
export function pickField(
  decoded: Record<string, unknown>,
  snake: string,
  camel: string
): unknown {
  if (decoded[snake] !== undefined) {
    return decoded[snake];
  }
  return decoded[camel];
}
