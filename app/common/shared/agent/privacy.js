// What never leaves the station for the agent: authorization headers,
// cookies and tokens always, and values that look like personal data,
// replaced by the masking patterns the person set for AI.

// values that never leave the machine: card numbers, IBANs, phones, emails
export const DEFAULT_MASK_PATTERNS = [
  '\\b\\d{4}[ -]?\\d{2,4}[ -]?\\d{2,4}[ -]?\\d{4}\\b',
  '\\bUA\\d{2}[ \\d]{20,}\\b',
  '\\+?\\d[\\d ()-]{8,}\\d',
  '[\\w.+-]+@[\\w-]+\\.[\\w.]+',
];

export const MASK = '•••';

const SECRET_HEADER =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-access-token|x-csrf-token|x-xsrf-token)$|token|secret|session|passw/i;

// a JSON field that holds a secret, whatever the API calls it
const SECRET_FIELD =
  /"((?:access|refresh|id)?_?token|password|passwd|secret|client_secret|api_?key|pin|cvv|otp)"\s*:\s*"[^"]*"/gi;

/** The masking patterns as regular expressions; a broken one is skipped. */
export function compileMasks(patterns = DEFAULT_MASK_PATTERNS) {
  return patterns
    .map((pattern) => {
      try {
        return new RegExp(pattern, 'g');
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** A text with secret JSON fields and personal values replaced. */
export function maskText(text, masks = compileMasks()) {
  if (typeof text !== 'string' || !text) {
    return text;
  }
  let value = text.replace(SECRET_FIELD, (_match, name) => `"${name}":"${MASK}"`);
  for (const pattern of masks) {
    value = value.replace(pattern, MASK);
  }
  return value;
}

/** Headers without their secrets: the name stays, so the agent knows one was there. */
export function maskHeaders(headers = {}, masks = compileMasks()) {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [
      name,
      SECRET_HEADER.test(name) ? MASK : maskText(Array.isArray(value) ? value.join(', ') : String(value ?? ''), masks),
    ]),
  );
}

/** A query string without values that look like secrets or personal data. */
export function maskUrl(url, masks = compileMasks()) {
  try {
    const parsed = new URL(url);
    for (const [name] of parsed.searchParams) {
      if (SECRET_HEADER.test(name)) {
        parsed.searchParams.set(name, MASK);
      }
    }
    return maskText(parsed.toString(), masks);
  } catch {
    return maskText(String(url ?? ''), masks);
  }
}
