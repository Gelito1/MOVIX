export interface ResolvedAdDestination {
  href: string;
  isExternal: boolean;
}

const SCHEME_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const BARE_DOMAIN_REGEX = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+([/:?#].*)?$/;

/**
 * Safely normalizes an ad destination URL for public navigation.
 * Supports full https/http URLs, bare domains (auto-prefixed with https://),
 * and internal MOVIX hash/relative routes (#/... or /...).
 * Strictly rejects javascript:, data:, vbscript:, protocol-relative //, etc.
 */
export function resolveAdDestination(raw: string | null | undefined): ResolvedAdDestination | null {
  const trimmed = (raw || '').trim().slice(0, 600);
  if (!trimmed || /[\u0000-\u001F\s]/.test(trimmed)) return null;

  if (trimmed.startsWith('#/')) {
    return { href: trimmed, isExternal: false };
  }
  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//')) return null;
    return { href: trimmed, isExternal: false };
  }

  let candidate = trimmed;
  if (!SCHEME_REGEX.test(candidate)) {
    if (!BARE_DOMAIN_REGEX.test(candidate)) return null;
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return { href: parsed.toString(), isExternal: true };
    }
  } catch {
    // invalid URL
  }
  return null;
}
