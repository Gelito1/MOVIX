import type { SupportedLanguage } from './firebase';

export type AdUiLang = SupportedLanguage;

type CtaBundle = Record<AdUiLang, string>;

function normalizeCtaKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[!?.:;()[\]{}'"`~@#$%^&*_=+|\\/<>]+/g, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CTA_GROUPS: Array<{ aliases: string[]; labels: CtaBundle }> = [
  {
    aliases: ['saiba mais', 'saber mais', 'learn more', 'know more', 'mas informacion', 'saber mas', 'en savoir plus', 'scopri di piu'],
    labels: {
      'pt-BR': 'Saiba mais',
      'pt-PT': 'Saber mais',
      en: 'Learn more',
      'es-419': 'Más información',
      'es-ES': 'Más información',
      fr: 'En savoir plus',
      it: 'Scopri di più',
    },
  },
  {
    aliases: ['registar se', 'registrar se', 'registar', 'registrar', 'cadastrar se', 'cadastre se', 'cadastrar', 'criar conta', 'sign up', 'register', 'create account', 'registrarse', 'registrate', 'crear cuenta', 's inscrire', 'creer un compte', 'registrati', 'iscriviti'],
    labels: {
      'pt-BR': 'Cadastrar-se',
      'pt-PT': 'Registar-se',
      en: 'Sign up',
      'es-419': 'Registrarse',
      'es-ES': 'Registrarse',
      fr: "S'inscrire",
      it: 'Registrati',
    },
  },
  {
    aliases: ['entrar', 'iniciar sessao', 'fazer login', 'login', 'sign in', 'log in', 'iniciar sesion', 'se connecter', 'connexion', 'accedi'],
    labels: {
      'pt-BR': 'Entrar',
      'pt-PT': 'Entrar',
      en: 'Sign in',
      'es-419': 'Iniciar sesión',
      'es-ES': 'Iniciar sesión',
      fr: 'Se connecter',
      it: 'Accedi',
    },
  },
  {
    aliases: ['visitar', 'visitar site', 'visite o site', 'visit', 'visit site', 'visit website', 'visitar sitio', 'visitar web', 'visiter', 'visiter le site', 'visita', 'visita il sito'],
    labels: {
      'pt-BR': 'Visitar site',
      'pt-PT': 'Visitar site',
      en: 'Visit site',
      'es-419': 'Visitar sitio',
      'es-ES': 'Visitar sitio',
      fr: 'Visiter le site',
      it: 'Visita il sito',
    },
  },
  {
    aliases: ['visitar oferta', 'ver oferta', 'ver promocao', 'conferir oferta', 'view offer', 'see offer', 'see deal', 'ver oferta', 'voir l offre', 'vedi offerta'],
    labels: {
      'pt-BR': 'Ver oferta',
      'pt-PT': 'Ver oferta',
      en: 'View offer',
      'es-419': 'Ver oferta',
      'es-ES': 'Ver oferta',
      fr: "Voir l'offre",
      it: 'Vedi offerta',
    },
  },
  {
    aliases: ['aproveitar', 'aproveitar oferta', 'aproveite', 'aproveite agora', 'claim offer', 'get offer', 'grab deal', 'aprovechar', 'aprovechar oferta', 'profiter', 'en profiter', 'approfitta'],
    labels: {
      'pt-BR': 'Aproveitar',
      'pt-PT': 'Aproveitar',
      en: 'Claim offer',
      'es-419': 'Aprovechar',
      'es-ES': 'Aprovechar',
      fr: 'En profiter',
      it: 'Approfitta',
    },
  },
  {
    aliases: ['comprar', 'comprar agora', 'compre agora', 'buy', 'buy now', 'shop now', 'shop', 'comprar ahora', 'acheter', 'acheter maintenant', 'acquista', 'acquista ora', 'compra ora'],
    labels: {
      'pt-BR': 'Comprar agora',
      'pt-PT': 'Comprar agora',
      en: 'Buy now',
      'es-419': 'Comprar ahora',
      'es-ES': 'Comprar ahora',
      fr: 'Acheter',
      it: 'Acquista ora',
    },
  },
  {
    aliases: ['baixar', 'baixar agora', 'descarregar', 'descarregar agora', 'download', 'download now', 'descargar', 'descargar ahora', 'telecharger', 'scarica', 'scarica ora'],
    labels: {
      'pt-BR': 'Baixar agora',
      'pt-PT': 'Descarregar',
      en: 'Download',
      'es-419': 'Descargar',
      'es-ES': 'Descargar',
      fr: 'Télécharger',
      it: 'Scarica',
    },
  },
  {
    aliases: ['baixar app', 'baixar aplicativo', 'descarregar app', 'download app', 'get the app', 'get app', 'descargar app', 'telecharger l app', 'scarica l app'],
    labels: {
      'pt-BR': 'Baixar app',
      'pt-PT': 'Descarregar app',
      en: 'Download app',
      'es-419': 'Descargar app',
      'es-ES': 'Descargar app',
      fr: "Télécharger l'app",
      it: "Scarica l'app",
    },
  },
  {
    aliases: ['instalar', 'instalar agora', 'instalar app', 'install', 'install now', 'install app', 'installer', 'installa'],
    labels: {
      'pt-BR': 'Instalar',
      'pt-PT': 'Instalar',
      en: 'Install',
      'es-419': 'Instalar',
      'es-ES': 'Instalar',
      fr: 'Installer',
      it: 'Installa',
    },
  },
  {
    aliases: ['abrir', 'abrir agora', 'open', 'open now', 'ouvrir', 'apri'],
    labels: {
      'pt-BR': 'Abrir',
      'pt-PT': 'Abrir',
      en: 'Open',
      'es-419': 'Abrir',
      'es-ES': 'Abrir',
      fr: 'Ouvrir',
      it: 'Apri',
    },
  },
  {
    aliases: ['acessar', 'acessar agora', 'aceder', 'aceder agora', 'access', 'access now', 'go now', 'acceder', 'acceder ahora', 'acceder maintenant'],
    labels: {
      'pt-BR': 'Acessar',
      'pt-PT': 'Aceder',
      en: 'Access now',
      'es-419': 'Acceder',
      'es-ES': 'Acceder',
      fr: 'Accéder',
      it: 'Accedi',
    },
  },
  {
    aliases: ['ver mais', 'veja mais', 'see more', 'view more', 'ver mas', 'voir plus', 'vedi altro', 'mostra di piu'],
    labels: {
      'pt-BR': 'Ver mais',
      'pt-PT': 'Ver mais',
      en: 'See more',
      'es-419': 'Ver más',
      'es-ES': 'Ver más',
      fr: 'Voir plus',
      it: 'Vedi altro',
    },
  },
  {
    aliases: ['ver agora', 'veja agora', 'confira', 'conferir', 'check it out', 'view now', 'see now', 'ver ahora', 'voir maintenant', 'guarda ora'],
    labels: {
      'pt-BR': 'Ver agora',
      'pt-PT': 'Ver agora',
      en: 'View now',
      'es-419': 'Ver ahora',
      'es-ES': 'Ver ahora',
      fr: 'Voir maintenant',
      it: 'Vedi ora',
    },
  },
  {
    aliases: ['assistir', 'assistir agora', 'watch', 'watch now', 'ver ahora', 'regarder', 'guarda', 'guarda ora'],
    labels: {
      'pt-BR': 'Assistir agora',
      'pt-PT': 'Ver agora',
      en: 'Watch now',
      'es-419': 'Ver ahora',
      'es-ES': 'Ver ahora',
      fr: 'Regarder',
      it: 'Guarda ora',
    },
  },
  {
    aliases: ['jogar', 'jogar agora', 'jogue agora', 'play', 'play now', 'jugar', 'jugar ahora', 'jouer', 'jouer maintenant', 'gioca', 'gioca ora'],
    labels: {
      'pt-BR': 'Jogar agora',
      'pt-PT': 'Jogar agora',
      en: 'Play now',
      'es-419': 'Jugar ahora',
      'es-ES': 'Jugar ahora',
      fr: 'Jouer',
      it: 'Gioca ora',
    },
  },
  {
    aliases: ['apostar', 'apostar agora', 'aposte agora', 'bet', 'bet now', 'apostar ahora', 'parier', 'scommetti'],
    labels: {
      'pt-BR': 'Apostar agora',
      'pt-PT': 'Apostar agora',
      en: 'Bet now',
      'es-419': 'Apostar ahora',
      'es-ES': 'Apostar ahora',
      fr: 'Parier',
      it: 'Scommetti ora',
    },
  },
  {
    aliases: ['comecar', 'comecar agora', 'comece agora', 'iniciar', 'get started', 'start now', 'start', 'empezar', 'comenzar', 'commencer', 'inizia'],
    labels: {
      'pt-BR': 'Começar',
      'pt-PT': 'Começar',
      en: 'Get started',
      'es-419': 'Comenzar',
      'es-ES': 'Empezar',
      fr: 'Commencer',
      it: 'Inizia',
    },
  },
  {
    aliases: ['testar gratis', 'experimentar', 'experimentar gratis', 'teste gratis', 'try free', 'free trial', 'try now', 'probar gratis', 'essai gratuit', 'essayer', 'prova gratis'],
    labels: {
      'pt-BR': 'Testar grátis',
      'pt-PT': 'Experimentar grátis',
      en: 'Try for free',
      'es-419': 'Probar gratis',
      'es-ES': 'Probar gratis',
      fr: 'Essayer gratuitement',
      it: 'Prova gratis',
    },
  },
  {
    aliases: ['inscrever se', 'inscreva se', 'subscrever', 'assinar', 'assinar agora', 'subscribe', 'subscribe now', 'suscribirse', 's abonner', 'abbonati', 'iscriviti'],
    labels: {
      'pt-BR': 'Assinar agora',
      'pt-PT': 'Subscrever',
      en: 'Subscribe',
      'es-419': 'Suscribirse',
      'es-ES': 'Suscribirse',
      fr: "S'abonner",
      it: 'Abbonati',
    },
  },
  {
    aliases: ['resgatar', 'resgatar bonus', 'pegar bonus', 'receber bonus', 'claim bonus', 'get bonus', 'claim now', 'reclamar', 'reclamar bono', 'reclamer', 'riscatta', 'ottieni bonus'],
    labels: {
      'pt-BR': 'Resgatar bônus',
      'pt-PT': 'Resgatar bónus',
      en: 'Claim bonus',
      'es-419': 'Reclamar bono',
      'es-ES': 'Reclamar bono',
      fr: 'Réclamer le bonus',
      it: 'Riscatta bonus',
    },
  },
  {
    aliases: ['participar', 'participe', 'participe agora', 'join', 'join now', 'unirse', 'unete', 'rejoindre', 'partecipa', 'unisciti'],
    labels: {
      'pt-BR': 'Participar',
      'pt-PT': 'Participar',
      en: 'Join now',
      'es-419': 'Participar',
      'es-ES': 'Participar',
      fr: 'Rejoindre',
      it: 'Partecipa',
    },
  },
  {
    aliases: ['obter', 'obter agora', 'garantir', 'garantir agora', 'get now', 'get it now', 'obtener', 'obtenir', 'ottieni'],
    labels: {
      'pt-BR': 'Obter agora',
      'pt-PT': 'Obter agora',
      en: 'Get now',
      'es-419': 'Obtener ahora',
      'es-ES': 'Obtener ahora',
      fr: 'Obtenir',
      it: 'Ottieni ora',
    },
  },
  {
    aliases: ['fale conosco', 'falar conosco', 'falar no whatsapp', 'contato', 'contacto', 'contact us', 'contact', 'contactar', 'contacter', 'contattaci'],
    labels: {
      'pt-BR': 'Fale conosco',
      'pt-PT': 'Contactar',
      en: 'Contact us',
      'es-419': 'Contáctanos',
      'es-ES': 'Contactar',
      fr: 'Nous contacter',
      it: 'Contattaci',
    },
  },
  {
    aliases: ['conhecer', 'descobrir', 'descubra', 'explorar', 'discover', 'explore', 'descubrir', 'explorar', 'decouvrir', 'explorer', 'scopri', 'esplora'],
    labels: {
      'pt-BR': 'Descobrir',
      'pt-PT': 'Descobrir',
      en: 'Discover',
      'es-419': 'Descubrir',
      'es-ES': 'Descubrir',
      fr: 'Découvrir',
      it: 'Scopri',
    },
  },
  {
    aliases: ['seguir', 'siga', 'follow', 'follow us', 'seguirnos', 'suivre', 'segui'],
    labels: {
      'pt-BR': 'Seguir',
      'pt-PT': 'Seguir',
      en: 'Follow',
      'es-419': 'Seguir',
      'es-ES': 'Seguir',
      fr: 'Suivre',
      it: 'Segui',
    },
  },
];

const CTA_LOOKUP = new Map<string, CtaBundle>();
for (const group of CTA_GROUPS) {
  for (const alias of group.aliases) {
    CTA_LOOKUP.set(normalizeCtaKey(alias), group.labels);
  }
}

export function normalizeAdUiLang(raw?: string | null): AdUiLang {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'pt-pt' || val === 'pt_pt') return 'pt-PT';
  if (val.startsWith('pt')) return 'pt-BR';
  if (val.startsWith('en')) return 'en';
  if (val === 'es-es' || val === 'es_es') return 'es-ES';
  if (val.startsWith('es')) return 'es-419';
  if (val.startsWith('fr')) return 'fr';
  if (val.startsWith('it')) return 'it';
  return 'pt-BR';
}

/**
 * Instantly translates standard ad CTA button texts (e.g. "Saiba mais", "Registar-se",
 * "Visitar oferta", "Baixar app", "Jogar agora", etc.) into the user's active language.
 * Returns null if the phrase is a custom CTA not in the built-in dictionary.
 */
export function lookupKnownAdCta(rawCta: string | undefined | null, lang?: string | null): string | null {
  const clean = (rawCta || '').trim();
  if (!clean) return null;
  const key = normalizeCtaKey(clean);
  if (!key) return null;
  const bundle = CTA_LOOKUP.get(key);
  if (!bundle) return null;
  return bundle[normalizeAdUiLang(lang)];
}

/**
 * Resolves the localized CTA button label for display in any MOVIX ad slot.
 * Always translates known CTA labels immediately into `lang`, and falls back to
 * `fallbackLabel` when empty or to the (server-translated) `rawCta` for custom phrases.
 */
export function translateAdCtaText(
  rawCta: string | undefined | null,
  lang?: string | null,
  fallbackLabel?: string
): string {
  const clean = (rawCta || '').trim();
  if (!clean) {
    return fallbackLabel || CTA_GROUPS[0].labels[normalizeAdUiLang(lang)];
  }
  const known = lookupKnownAdCta(clean, lang);
  if (known) return known;
  return clean;
}
