import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { saveAdmStore, type AdCampaign, type AdLocalizedTexts } from './admStore.ts';

export type SupportedAdLang = 'pt-BR' | 'pt-PT' | 'en' | 'es-419' | 'es-ES' | 'fr' | 'it';

const ALL_SUPPORTED_LANGS: SupportedAdLang[] = [
  'pt-BR',
  'pt-PT',
  'en',
  'es-419',
  'es-ES',
  'fr',
  'it',
];

const LANG_DISPLAY_NAMES: Record<SupportedAdLang, string> = {
  'pt-BR': 'Brazilian Portuguese (pt-BR)',
  'pt-PT': 'European Portuguese (pt-PT)',
  en: 'English (en)',
  'es-419': 'Latin American Spanish (es-419)',
  'es-ES': 'European Spanish (es-ES)',
  fr: 'French (fr)',
  it: 'Italian (it)',
};

const GOOGLE_TRANSLATE_CODES: Record<SupportedAdLang, string> = {
  'pt-BR': 'pt',
  'pt-PT': 'pt',
  en: 'en',
  'es-419': 'es',
  'es-ES': 'es',
  fr: 'fr',
  it: 'it',
};

const inFlightTranslations = new Map<string, Promise<AdLocalizedTexts>>();
const adHocTextCache = new Map<
  string,
  { title: string; description: string; ctaText: string }
>();

const COMMON_CTA_MAP: Array<{ aliases: string[]; labels: Record<SupportedAdLang, string> }> = [
  {
    aliases: ['saiba mais', 'saber mais', 'learn more', 'mas informacion', 'en savoir plus', 'scopri di piu'],
    labels: { 'pt-BR': 'Saiba mais', 'pt-PT': 'Saber mais', en: 'Learn more', 'es-419': 'Más información', 'es-ES': 'Más información', fr: 'En savoir plus', it: 'Scopri di più' },
  },
  {
    aliases: ['registar se', 'registrar se', 'cadastrar se', 'cadastre se', 'criar conta', 'sign up', 'register', 'registrarse', 's inscrire', 'registrati'],
    labels: { 'pt-BR': 'Cadastrar-se', 'pt-PT': 'Registar-se', en: 'Sign up', 'es-419': 'Registrarse', 'es-ES': 'Registrarse', fr: "S'inscrire", it: 'Registrati' },
  },
  {
    aliases: ['entrar', 'iniciar sessao', 'sign in', 'login', 'iniciar sesion', 'se connecter', 'accedi'],
    labels: { 'pt-BR': 'Entrar', 'pt-PT': 'Entrar', en: 'Sign in', 'es-419': 'Iniciar sesión', 'es-ES': 'Iniciar sesión', fr: 'Se connecter', it: 'Accedi' },
  },
  {
    aliases: ['visitar', 'visitar site', 'visit site', 'visitar sitio', 'visiter le site', 'visita il sito'],
    labels: { 'pt-BR': 'Visitar site', 'pt-PT': 'Visitar site', en: 'Visit site', 'es-419': 'Visitar sitio', 'es-ES': 'Visitar sitio', fr: 'Visiter le site', it: 'Visita il sito' },
  },
  {
    aliases: ['visitar oferta', 'ver oferta', 'view offer', 'voir l offre', 'vedi offerta'],
    labels: { 'pt-BR': 'Ver oferta', 'pt-PT': 'Ver oferta', en: 'View offer', 'es-419': 'Ver oferta', 'es-ES': 'Ver oferta', fr: "Voir l'offre", it: 'Vedi offerta' },
  },
  {
    aliases: ['comprar', 'comprar agora', 'buy now', 'shop now', 'comprar ahora', 'acheter', 'acquista ora'],
    labels: { 'pt-BR': 'Comprar agora', 'pt-PT': 'Comprar agora', en: 'Buy now', 'es-419': 'Comprar ahora', 'es-ES': 'Comprar ahora', fr: 'Acheter', it: 'Acquista ora' },
  },
  {
    aliases: ['baixar', 'baixar agora', 'descarregar', 'download', 'download now', 'descargar', 'telecharger', 'scarica'],
    labels: { 'pt-BR': 'Baixar agora', 'pt-PT': 'Descarregar', en: 'Download', 'es-419': 'Descargar', 'es-ES': 'Descargar', fr: 'Télécharger', it: 'Scarica' },
  },
  {
    aliases: ['baixar app', 'descarregar app', 'download app', 'descargar app', 'telecharger l app', 'scarica l app'],
    labels: { 'pt-BR': 'Baixar app', 'pt-PT': 'Descarregar app', en: 'Download app', 'es-419': 'Descargar app', 'es-ES': 'Descargar app', fr: "Télécharger l'app", it: "Scarica l'app" },
  },
  {
    aliases: ['jogar', 'jogar agora', 'play now', 'jugar ahora', 'jouer', 'gioca ora'],
    labels: { 'pt-BR': 'Jogar agora', 'pt-PT': 'Jogar agora', en: 'Play now', 'es-419': 'Jugar ahora', 'es-ES': 'Jugar ahora', fr: 'Jouer', it: 'Gioca ora' },
  },
  {
    aliases: ['apostar', 'apostar agora', 'bet now', 'apostar ahora', 'parier', 'scommetti ora'],
    labels: { 'pt-BR': 'Apostar agora', 'pt-PT': 'Apostar agora', en: 'Bet now', 'es-419': 'Apostar ahora', 'es-ES': 'Apostar ahora', fr: 'Parier', it: 'Scommetti ora' },
  },
  {
    aliases: ['aproveitar', 'aproveitar oferta', 'claim offer', 'aprovechar', 'en profiter', 'approfitta'],
    labels: { 'pt-BR': 'Aproveitar', 'pt-PT': 'Aproveitar', en: 'Claim offer', 'es-419': 'Aprovechar', 'es-ES': 'Aprovechar', fr: 'En profiter', it: 'Approfitta' },
  },
  {
    aliases: ['abrir', 'open', 'ouvrir', 'apri'],
    labels: { 'pt-BR': 'Abrir', 'pt-PT': 'Abrir', en: 'Open', 'es-419': 'Abrir', 'es-ES': 'Abrir', fr: 'Ouvrir', it: 'Apri' },
  },
  {
    aliases: ['ver mais', 'see more', 'ver mas', 'voir plus', 'vedi altro'],
    labels: { 'pt-BR': 'Ver mais', 'pt-PT': 'Ver mais', en: 'See more', 'es-419': 'Ver más', 'es-ES': 'Ver más', fr: 'Voir plus', it: 'Vedi altro' },
  },
  {
    aliases: ['resgatar bonus', 'resgatar', 'claim bonus', 'reclamar bono', 'reclamer le bonus', 'riscatta bonus'],
    labels: { 'pt-BR': 'Resgatar bônus', 'pt-PT': 'Resgatar bónus', en: 'Claim bonus', 'es-419': 'Reclamar bono', 'es-ES': 'Reclamar bono', fr: 'Réclamer le bonus', it: 'Riscatta bonus' },
  },
];

const SERVER_CTA_LOOKUP = new Map<string, Record<SupportedAdLang, string>>();
for (const entry of COMMON_CTA_MAP) {
  for (const alias of entry.aliases) {
    SERVER_CTA_LOOKUP.set(alias, entry.labels);
  }
}

function lookupServerCta(rawCta: string, targetLang: SupportedAdLang): string | null {
  const key = rawCta
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[!?.:;()[\]{}'"`~@#$%^&*_=+|\\/<>]+/g, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!key) return null;
  return SERVER_CTA_LOOKUP.get(key)?.[targetLang] ?? null;
}

let cachedGeminiClient: GoogleGenAI | null | undefined;
function getGeminiClient(): GoogleGenAI | null {
  if (cachedGeminiClient !== undefined) return cachedGeminiClient;
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    cachedGeminiClient = null;
    return null;
  }
  cachedGeminiClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return cachedGeminiClient;
}

export function normalizeSupportedLang(raw: unknown): SupportedAdLang {
  const val = String(raw || '').trim().toLowerCase();
  if (!val) return 'pt-BR';
  if (val === 'pt-pt' || val === 'pt_pt') return 'pt-PT';
  if (val.startsWith('pt')) return 'pt-BR';
  if (val.startsWith('en')) return 'en';
  if (val === 'es-es' || val === 'es_es') return 'es-ES';
  if (val.startsWith('es')) return 'es-419';
  if (val.startsWith('fr')) return 'fr';
  if (val.startsWith('it')) return 'it';
  return 'pt-BR';
}

export function computeAdTextHash(ad: Pick<AdCampaign, 'name' | 'title' | 'description' | 'ctaText'>): string {
  const raw = [
    ad.name || '',
    ad.title || '',
    ad.description || '',
    ad.ctaText || '',
  ].join('\u0001');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

async function translateSingleFieldViaGoogle(
  text: string,
  targetLang: SupportedAdLang
): Promise<string> {
  const clean = text.trim();
  if (!clean) return '';
  // Skip pure numbers / punctuation / URLs
  if (/^[\d\s.,:%$€£+\-!?/]+$/.test(clean) || /^https?:\/\//i.test(clean)) {
    return clean;
  }

  const tl = GOOGLE_TRANSLATE_CODES[targetLang];
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(
    tl
  )}&dt=t&q=${encodeURIComponent(clean)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) {
    throw new Error(`Translate HTTP ${res.status}`);
  }
  const data = (await res.json()) as unknown[];
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    return clean;
  }
  const segments = data[0] as unknown[];
  const translated = segments
    .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
    .join('')
    .trim();
  return translated || clean;
}

async function translateFieldsWithGemini(
  fields: { name: string; title: string; description: string; ctaText: string },
  targetLang: SupportedAdLang
): Promise<{ name: string; title: string; description: string; ctaText: string } | null> {
  const ai = getGeminiClient();
  if (!ai) return null;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: `Translate all advertising copy fields into ${LANG_DISPLAY_NAMES[targetLang]}. Keep brand names, product names, and URLs natural, keep CTA buttons short and punchy, and if any field is already in the target language keep it clean and natural. Input JSON:\n${JSON.stringify(
        fields
      )}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            ctaText: { type: Type.STRING },
          },
          required: ['name', 'title', 'description', 'ctaText'],
        },
      },
    });
    const parsed = JSON.parse((response.text || '').trim()) as Partial<{
      name: string;
      title: string;
      description: string;
      ctaText: string;
    }>;
    return {
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim().slice(0, 140) : fields.name,
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim().slice(0, 160) : fields.title,
      description:
        typeof parsed.description === 'string'
          ? parsed.description.trim().slice(0, 560)
          : fields.description,
      ctaText:
        typeof parsed.ctaText === 'string' && parsed.ctaText.trim()
          ? parsed.ctaText.trim().slice(0, 50)
          : fields.ctaText,
    };
  } catch {
    return null;
  }
}

async function translateAdFields(
  ad: AdCampaign,
  targetLang: SupportedAdLang
): Promise<AdLocalizedTexts> {
  const sourceHash = computeAdTextHash(ad);
  const existing = ad.translations?.[targetLang];
  if (existing && existing.sourceHash === sourceHash) {
    return existing;
  }

  const flightKey = `${ad.id}:${targetLang}:${sourceHash}`;
  const pending = inFlightTranslations.get(flightKey);
  if (pending) return pending;

  const task = (async (): Promise<AdLocalizedTexts> => {
    const sourceFields = {
      name: ad.name || '',
      title: ad.title || '',
      description: ad.description || '',
      ctaText: ad.ctaText || '',
    };

    // If all fields are empty, skip network calls
    if (!sourceFields.name && !sourceFields.title && !sourceFields.description && !sourceFields.ctaText) {
      return {
        ...sourceFields,
        sourceHash,
        updatedAt: new Date().toISOString(),
      };
    }

    const knownCta = sourceFields.ctaText ? lookupServerCta(sourceFields.ctaText, targetLang) : null;

    // 1. Try Gemini server-side when GEMINI_API_KEY is available
    let translated = await translateFieldsWithGemini(sourceFields, targetLang);

    // 2. Fallback to real-time Google Translate HTTPS endpoint
    if (!translated) {
      try {
        const [name, title, description, ctaText] = await Promise.all([
          sourceFields.name && sourceFields.name !== sourceFields.title
            ? translateSingleFieldViaGoogle(sourceFields.name, targetLang)
            : Promise.resolve(''),
          sourceFields.title
            ? translateSingleFieldViaGoogle(sourceFields.title, targetLang)
            : Promise.resolve(''),
          sourceFields.description
            ? translateSingleFieldViaGoogle(sourceFields.description, targetLang)
            : Promise.resolve(''),
          knownCta
            ? Promise.resolve(knownCta)
            : sourceFields.ctaText
              ? translateSingleFieldViaGoogle(sourceFields.ctaText, targetLang)
              : Promise.resolve(''),
        ]);
        translated = {
          name: (name || title || sourceFields.name).slice(0, 140),
          title: (title || sourceFields.title).slice(0, 160),
          description: (description || sourceFields.description).slice(0, 560),
          ctaText: (knownCta || ctaText || sourceFields.ctaText).slice(0, 50),
        };
      } catch {
        return {
          ...sourceFields,
          ctaText: knownCta || sourceFields.ctaText,
          sourceHash,
          updatedAt: new Date().toISOString(),
        };
      }
    }

    const record: AdLocalizedTexts = {
      name: translated.name,
      title: translated.title,
      description: translated.description,
      ctaText: knownCta || translated.ctaText,
      sourceHash,
      updatedAt: new Date().toISOString(),
    };

    if (!ad.translations) {
      ad.translations = {};
    }
    ad.translations[targetLang] = record;
    return record;
  })();

  inFlightTranslations.set(flightKey, task);
  try {
    return await task;
  } finally {
    inFlightTranslations.delete(flightKey);
  }
}

export async function localizePublicAds(
  ads: AdCampaign[],
  targetLang: SupportedAdLang
): Promise<Map<string, { name: string; title: string; description: string; ctaText: string }>> {
  const result = new Map<string, { name: string; title: string; description: string; ctaText: string }>();
  if (ads.length === 0) return result;

  let cacheMutated = false;

  await Promise.all(
    ads.map(async (ad) => {
      const hash = computeAdTextHash(ad);
      const cached = ad.translations?.[targetLang];
      if (cached && cached.sourceHash === hash) {
        result.set(ad.id, {
          name: cached.name || ad.name,
          title: cached.title || ad.title,
          description: cached.description,
          ctaText: cached.ctaText || ad.ctaText,
        });
        return;
      }

      const localized = await translateAdFields(ad, targetLang);
      if (ad.translations?.[targetLang]?.sourceHash === hash) {
        cacheMutated = true;
      }
      result.set(ad.id, {
        name: localized.name || ad.name,
        title: localized.title || ad.title,
        description: localized.description,
        ctaText: localized.ctaText || ad.ctaText,
      });
    })
  );

  if (cacheMutated) {
    try {
      saveAdmStore();
    } catch {
      // Ignore disk save errors during read
    }
  }

  return result;
}

/**
 * Pre-translates an ad campaign across all supported MOVIX languages in the background
 * right after creation/update so every international user gets instant 0ms translations.
 */
export function prewarmAdTranslations(ad: AdCampaign): void {
  void (async () => {
    let changed = false;
    const hash = computeAdTextHash(ad);
    for (const lang of ALL_SUPPORTED_LANGS) {
      if (ad.translations?.[lang]?.sourceHash === hash) continue;
      try {
        await translateAdFields(ad, lang);
        if (ad.translations?.[lang]?.sourceHash === hash) {
          changed = true;
        }
      } catch {
        // Ignore individual language failures
      }
    }
    if (changed) {
      try {
        saveAdmStore();
      } catch {
        // Ignore background persist errors
      }
    }
  })();
}

/**
 * Translates arbitrary cloud-loaded public ad copy (title, description, ctaText)
 * into `targetLang` with in-memory caching so Cloud Firestore ads also translate
 * cleanly across all languages even when absent from local container disk.
 */
export async function translateAdTextsBatch(
  items: Array<{ id: string; title: string; description: string; ctaText: string }>,
  targetLang: SupportedAdLang
): Promise<Record<string, { title: string; description: string; ctaText: string }>> {
  const out: Record<string, { title: string; description: string; ctaText: string }> = {};
  const slice = items.slice(0, 20);

  await Promise.all(
    slice.map(async (item) => {
      const id = String(item.id || '').slice(0, 128);
      const title = String(item.title || '').trim().slice(0, 200);
      const description = String(item.description || '').trim().slice(0, 600);
      const ctaText = String(item.ctaText || '').trim().slice(0, 80);
      if (!id) return;

      const knownCta = ctaText ? lookupServerCta(ctaText, targetLang) : null;
      const hash = computeAdTextHash({ name: '', title, description, ctaText });
      const cacheKey = `${targetLang}:${hash}`;
      const cached = adHocTextCache.get(cacheKey);
      if (cached) {
        out[id] = {
          title: cached.title,
          description: cached.description,
          ctaText: knownCta || cached.ctaText,
        };
        return;
      }

      if (!title && !description && (!ctaText || knownCta)) {
        const direct = { title, description, ctaText: knownCta || ctaText };
        adHocTextCache.set(cacheKey, direct);
        out[id] = direct;
        return;
      }

      let translated = await translateFieldsWithGemini(
        { name: title, title, description, ctaText },
        targetLang
      );

      if (!translated) {
        try {
          const [tTitle, tDesc, tCta] = await Promise.all([
            title ? translateSingleFieldViaGoogle(title, targetLang) : Promise.resolve(''),
            description ? translateSingleFieldViaGoogle(description, targetLang) : Promise.resolve(''),
            knownCta
              ? Promise.resolve(knownCta)
              : ctaText
                ? translateSingleFieldViaGoogle(ctaText, targetLang)
                : Promise.resolve(''),
          ]);
          translated = {
            name: tTitle || title,
            title: (tTitle || title).slice(0, 200),
            description: (tDesc || description).slice(0, 600),
            ctaText: (knownCta || tCta || ctaText).slice(0, 80),
          };
        } catch {
          translated = {
            name: title,
            title,
            description,
            ctaText: knownCta || ctaText,
          };
        }
      }

      const finalEntry = {
        title: translated.title || title,
        description: translated.description || description,
        ctaText: knownCta || translated.ctaText || ctaText,
      };
      if (adHocTextCache.size > 500) {
        const firstKey = adHocTextCache.keys().next().value;
        if (firstKey) adHocTextCache.delete(firstKey);
      }
      adHocTextCache.set(cacheKey, finalEntry);
      out[id] = finalEntry;
    })
  );

  return out;
}
