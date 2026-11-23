export interface RuntimeSecrets {
  tmdbApiKey?: string;
  tmdbReadToken?: string;
  tmdbBaseUrl?: string;
  megambdServerUrl?: string;
  megambdEmbedUrl?: string;
  megambdApiKey?: string;
  megambdUsername?: string;
  megambdPassword?: string;
  firebaseServiceAccountJson?: string;
}

const ALLOWED_MEGAMBD_HOSTS = new Set([
  'mgeb.space',
  'api.mgeb.space',
  'megaembed.com',
  'www.megaembed.com',
]);
const DEFAULT_TMDB_BASE = 'https://api.themoviedb.org/3';
const DEFAULT_MEGAMBD_URL = 'https://mgeb.space/player_api.php';
const DEFAULT_MEGAMBD_EMBED_URL = 'https://megaembed.com';

let runtimeOverrides: RuntimeSecrets = {};

export function isAllowedMegambdHost(hostname: string): boolean {
  return ALLOWED_MEGAMBD_HOSTS.has(hostname.toLowerCase());
}

export function validateMegambdUrl(rawUrl: string): { valid: boolean; normalized?: string; error?: string } {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return { valid: true, normalized: DEFAULT_MEGAMBD_URL };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, error: 'O protocolo deve ser https:// ou http://.' };
    }
    if (!isAllowedMegambdHost(parsed.hostname)) {
      return {
        valid: false,
        error: `Servidor não autorizado (${parsed.hostname}). Utilize exclusivamente domínios oficiais MegamBD.`,
      };
    }
    return { valid: true, normalized: `${parsed.origin}/player_api.php` };
  } catch {
    return { valid: false, error: 'URL do servidor MegamBD inválido.' };
  }
}

export function validateMegambdEmbedUrl(rawUrl: string): { valid: boolean; normalized?: string; error?: string } {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return { valid: true, normalized: DEFAULT_MEGAMBD_EMBED_URL };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') {
      return { valid: false, error: 'O player MegamBD requer ligação segura https://.' };
    }
    if (!isAllowedMegambdHost(parsed.hostname)) {
      return {
        valid: false,
        error: `Domínio de embed não autorizado (${parsed.hostname}).`,
      };
    }
    return { valid: true, normalized: parsed.origin };
  } catch {
    return { valid: false, error: 'URL de embed MegamBD inválido.' };
  }
}

export function validateTmdbBaseUrl(rawUrl: string): { valid: boolean; normalized?: string; error?: string } {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return { valid: true, normalized: DEFAULT_TMDB_BASE };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'api.themoviedb.org') {
      return { valid: false, error: 'Apenas https://api.themoviedb.org/3 é permitido.' };
    }
    return { valid: true, normalized: trimmed.replace(/\/+$/, '') };
  } catch {
    return { valid: false, error: 'URL base do TMDB inválido.' };
  }
}

export function getServerConfig() {
  const tmdbBaseRaw = runtimeOverrides.tmdbBaseUrl ?? process.env.TMDB_BASE_URL ?? DEFAULT_TMDB_BASE;
  const tmdbBaseCheck = validateTmdbBaseUrl(tmdbBaseRaw);

  const megambdUrlRaw = runtimeOverrides.megambdServerUrl ?? process.env.MEGAMBD_SERVER_URL ?? DEFAULT_MEGAMBD_URL;
  const megambdCheck = validateMegambdUrl(megambdUrlRaw);

  const megambdEmbedRaw = runtimeOverrides.megambdEmbedUrl ?? process.env.MEGAMBD_EMBED_URL ?? DEFAULT_MEGAMBD_EMBED_URL;
  const megambdEmbedCheck = validateMegambdEmbedUrl(megambdEmbedRaw);

  return {
    tmdbApiKey: (runtimeOverrides.tmdbApiKey ?? process.env.TMDB_API_KEY ?? '').trim(),
    tmdbReadToken: (runtimeOverrides.tmdbReadToken ?? process.env.TMDB_READ_TOKEN ?? '').trim(),
    tmdbBaseUrl: tmdbBaseCheck.valid && tmdbBaseCheck.normalized ? tmdbBaseCheck.normalized : DEFAULT_TMDB_BASE,
    megambdServerUrl: megambdCheck.valid && megambdCheck.normalized ? megambdCheck.normalized : DEFAULT_MEGAMBD_URL,
    megambdEmbedUrl:
      megambdEmbedCheck.valid && megambdEmbedCheck.normalized
        ? megambdEmbedCheck.normalized
        : DEFAULT_MEGAMBD_EMBED_URL,
    megambdApiKey: (runtimeOverrides.megambdApiKey ?? process.env.MEGAMBD_API_KEY ?? '').trim(),
    megambdUsername: (runtimeOverrides.megambdUsername ?? process.env.MEGAMBD_USERNAME ?? '').trim(),
    megambdPassword: (runtimeOverrides.megambdPassword ?? process.env.MEGAMBD_PASSWORD ?? '').trim(),
    adminPasscode: (process.env.ADMIN_PASSCODE ?? '').trim(),
    firebaseServiceAccountJson: (
      runtimeOverrides.firebaseServiceAccountJson ??
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON ??
      ''
    ).trim(),
  };
}

export function updateRuntimeConfig(patch: RuntimeSecrets): { ok: boolean; error?: string } {
  if (patch.megambdServerUrl !== undefined) {
    const check = validateMegambdUrl(patch.megambdServerUrl);
    if (!check.valid) {
      return { ok: false, error: check.error };
    }
    runtimeOverrides.megambdServerUrl = check.normalized;
  }

  if (patch.megambdEmbedUrl !== undefined) {
    const check = validateMegambdEmbedUrl(patch.megambdEmbedUrl);
    if (!check.valid) {
      return { ok: false, error: check.error };
    }
    runtimeOverrides.megambdEmbedUrl = check.normalized;
  }

  if (patch.tmdbBaseUrl !== undefined) {
    const check = validateTmdbBaseUrl(patch.tmdbBaseUrl);
    if (!check.valid) {
      return { ok: false, error: check.error };
    }
    runtimeOverrides.tmdbBaseUrl = check.normalized;
  }

  if (patch.tmdbApiKey !== undefined && patch.tmdbApiKey.trim() !== '') {
    runtimeOverrides.tmdbApiKey = patch.tmdbApiKey.trim();
  }
  if (patch.tmdbReadToken !== undefined && patch.tmdbReadToken.trim() !== '') {
    runtimeOverrides.tmdbReadToken = patch.tmdbReadToken.trim();
  }
  if (patch.megambdApiKey !== undefined && patch.megambdApiKey.trim() !== '') {
    runtimeOverrides.megambdApiKey = patch.megambdApiKey.trim();
  }
  if (patch.megambdUsername !== undefined && patch.megambdUsername.trim() !== '') {
    runtimeOverrides.megambdUsername = patch.megambdUsername.trim();
  }
  if (patch.megambdPassword !== undefined && patch.megambdPassword.trim() !== '') {
    runtimeOverrides.megambdPassword = patch.megambdPassword.trim();
  }
  if (patch.firebaseServiceAccountJson !== undefined && patch.firebaseServiceAccountJson.trim() !== '') {
    try {
      const parsed = JSON.parse(patch.firebaseServiceAccountJson.trim()) as {
        project_id?: unknown;
        client_email?: unknown;
        private_key?: unknown;
      };
      if (
        typeof parsed.project_id !== 'string' ||
        typeof parsed.client_email !== 'string' ||
        typeof parsed.private_key !== 'string' ||
        !parsed.private_key.includes('PRIVATE KEY')
      ) {
        return {
          ok: false,
          error: 'FIREBASE_SERVICE_ACCOUNT_JSON inválido: faltam project_id, client_email ou private_key.',
        };
      }
      runtimeOverrides.firebaseServiceAccountJson = patch.firebaseServiceAccountJson.trim();
    } catch {
      return { ok: false, error: 'FIREBASE_SERVICE_ACCOUNT_JSON não é um JSON válido.' };
    }
  }

  return { ok: true };
}

function maskSecret(val: string): string {
  if (!val) return '';
  if (val.length <= 4) return '••••';
  return `••••${val.slice(-4)}`;
}

export function getParsedFirebaseServiceAccount(): {
  project_id: string;
  client_email: string;
  private_key: string;
} | null {
  const raw = getServerConfig().firebaseServiceAccountJson;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      project_id?: unknown;
      client_email?: unknown;
      private_key?: unknown;
    };
    if (
      typeof parsed.project_id === 'string' &&
      typeof parsed.client_email === 'string' &&
      typeof parsed.private_key === 'string' &&
      parsed.private_key.includes('PRIVATE KEY')
    ) {
      return {
        project_id: parsed.project_id,
        client_email: parsed.client_email,
        private_key: parsed.private_key.replace(/\\n/g, '\n'),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function getPublicConfigStatus() {
  const cfg = getServerConfig();
  const fcmSa = getParsedFirebaseServiceAccount();
  return {
    tmdbConfigured: Boolean(cfg.tmdbApiKey || cfg.tmdbReadToken),
    tmdbApiKeySet: Boolean(cfg.tmdbApiKey),
    tmdbApiKeyMasked: maskSecret(cfg.tmdbApiKey),
    tmdbReadTokenSet: Boolean(cfg.tmdbReadToken),
    tmdbReadTokenMasked: maskSecret(cfg.tmdbReadToken),
    tmdbBaseUrl: cfg.tmdbBaseUrl,
    megambdConfigured: Boolean(cfg.megambdApiKey || (cfg.megambdUsername && cfg.megambdPassword)),
    megambdServerUrl: cfg.megambdServerUrl,
    megambdEmbedUrl: cfg.megambdEmbedUrl,
    megambdApiKeySet: Boolean(cfg.megambdApiKey),
    megambdApiKeyMasked: maskSecret(cfg.megambdApiKey),
    megambdUsernameSet: Boolean(cfg.megambdUsername),
    megambdUsernameMasked: maskSecret(cfg.megambdUsername),
    megambdPasswordSet: Boolean(cfg.megambdPassword),
    adminEnvPasscodeSet: Boolean(cfg.adminPasscode),
    fcmServiceAccountSet: Boolean(fcmSa),
    fcmProjectId: fcmSa?.project_id || 'movix-e3099',
  };
}
