const SENSITIVE_FIELD_RE =
  /^(authorization|token|api[_-]?key|secret|password|cookie|refresh[_-]?token|access[_-]?token)$/i;

/**
 * Redact sensitive fields from decoded protobuf objects before display/logging.
 */
export function redactSensitive(obj: unknown, depth = 0): unknown {
  if (depth > 12 || obj == null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitive(item, depth + 1));
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  const record = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_FIELD_RE.test(key)) {
      out[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      out[key] = redactSensitive(value, depth + 1);
    } else {
      out[key] = value;
    }
  }

  return out;
}
