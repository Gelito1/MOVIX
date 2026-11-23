import type { SupportedLanguage } from './firebase';

const APP_TOUR_KEY = 'movix:tour_app_done:v1';
const PLAYER_TOUR_KEY = 'movix:tour_player_done:v1';

export type TourIconId =
  | 'search'
  | 'categories'
  | 'streaming'
  | 'list'
  | 'install'
  | 'profile'
  | 'nav'
  | 'cast'
  | 'display'
  | 'lock'
  | 'seek'
  | 'comments'
  | 'speed'
  | 'anthology'
  | 'pip'
  | 'fullscreen'
  | 'like'
  | 'download'
  | 'rotate'
  | 'feedback'
  | 'share'
  | 'audio'
  | 'gestures';

export interface TourStep {
  id: string;
  /** CSS selector(s) to spotlight, or null for a centered floating tip */
  selector: string | null;
  icon: TourIconId;
  title: string;
  description: string;
  padding?: number;
  borderRadius?: number;
}

export interface TourUiLabels {
  skipAll: string;
  next: string;
  finish: string;
  previous: string;
  replayTitle: string;
  replaySubtitle: string;
  playerHelpLabel: string;
}

function normalizeLangGroup(lang: SupportedLanguage): 'pt' | 'en' | 'es' | 'fr' | 'it' {
  if (lang.startsWith('pt')) return 'pt';
  if (lang.startsWith('es')) return 'es';
  if (lang === 'fr') return 'fr';
  if (lang === 'it') return 'it';
  return 'en';
}

export function isAppTourDone(): boolean {
  try {
    return localStorage.getItem(APP_TOUR_KEY) === '1';
  } catch {
    return false;
  }
}

export function markAppTourDone(): void {
  try {
    localStorage.setItem(APP_TOUR_KEY, '1');
  } catch {
    // Ignore storage failures
  }
}

export function isPlayerTourDone(): boolean {
  try {
    return localStorage.getItem(PLAYER_TOUR_KEY) === '1';
  } catch {
    return false;
  }
}

export function markPlayerTourDone(): void {
  try {
    localStorage.setItem(PLAYER_TOUR_KEY, '1');
  } catch {
    // Ignore storage failures
  }
}

export function resetAllTours(): void {
  try {
    localStorage.removeItem(APP_TOUR_KEY);
    localStorage.removeItem(PLAYER_TOUR_KEY);
  } catch {
    // Ignore storage failures
  }
}

export function getTourUiLabels(lang: SupportedLanguage): TourUiLabels {
  switch (normalizeLangGroup(lang)) {
    case 'en':
      return {
        skipAll: 'Skip all',
        next: 'Next',
        finish: 'Done',
        previous: 'Back',
        replayTitle: 'App & Player Tutorial',
        replaySubtitle: 'Review icons and shortcuts',
        playerHelpLabel: 'Player tutorial',
      };
    case 'es':
      return {
        skipAll: 'Omitir todo',
        next: 'Siguiente',
        finish: 'Listo',
        previous: 'Atrás',
        replayTitle: 'Tutorial de App y Player',
        replaySubtitle: 'Revisar íconos y funciones',
        playerHelpLabel: 'Tutorial del player',
      };
    case 'fr':
      return {
        skipAll: 'Tout passer',
        next: 'Suivant',
        finish: 'Terminer',
        previous: 'Retour',
        replayTitle: 'Tutoriel App & Lecteur',
        replaySubtitle: 'Revoir les icônes et fonctions',
        playerHelpLabel: 'Tutoriel du lecteur',
      };
    case 'it':
      return {
        skipAll: 'Salta tutto',
        next: 'Avanti',
        finish: 'Fine',
        previous: 'Indietro',
        replayTitle: 'Tutorial App e Player',
        replaySubtitle: 'Rivedi icone e funzioni',
        playerHelpLabel: 'Tutorial del player',
      };
    default:
      return {
        skipAll: 'Pular tudo',
        next: 'Próximo',
        finish: 'Concluir',
        previous: 'Voltar',
        replayTitle: 'Tutorial do App e Player',
        replaySubtitle: 'Rever ícones e funções',
        playerHelpLabel: 'Tutorial do player',
      };
  }
}

export function getAppTourSteps(lang: SupportedLanguage): TourStep[] {
  const g = normalizeLangGroup(lang);

  if (g === 'en') {
    return [
      {
        id: 'app-search',
        selector: '[data-tour="app-search"]',
        icon: 'search',
        title: 'Quick Search',
        description: 'Find movies, series, anime and dramas fast.',
        borderRadius: 999,
      },
      {
        id: 'app-categories',
        selector: '[data-tour="app-categories"]',
        icon: 'categories',
        title: 'Categories & +18',
        description: 'Swipe genres or unlock +18 with PIN.',
        borderRadius: 10,
      },
      {
        id: 'app-streaming',
        selector: '[data-tour="app-streaming"]',
        icon: 'streaming',
        title: 'Streaming Hubs',
        description: 'Browse Netflix, Disney+, Prime, Max & more.',
        borderRadius: 12,
      },
      {
        id: 'app-mylist',
        selector: '[data-tour="app-mylist-mobile"], [data-tour="app-mylist-desktop"]',
        icon: 'list',
        title: 'My List & Offline',
        description: 'Synced favorites, history and offline saves.',
        borderRadius: 10,
      },
      {
        id: 'app-install',
        selector: '[data-tour="app-install"]',
        icon: 'install',
        title: 'Install App',
        description: 'Add MOVIX to your home screen.',
        borderRadius: 10,
      },
      {
        id: 'app-profile',
        selector: '[data-tour="app-profile"]',
        icon: 'profile',
        title: 'Profile & Settings',
        description: 'Account, language, alerts and this guide.',
        borderRadius: 999,
      },
      {
        id: 'app-mobile-nav',
        selector: '[data-tour="app-mobile-nav"]',
        icon: 'nav',
        title: 'Quick Menu',
        description: 'Switch Home, Series, Movies and List.',
        borderRadius: 12,
      },
    ];
  }

  if (g === 'es') {
    return [
      {
        id: 'app-search',
        selector: '[data-tour="app-search"]',
        icon: 'search',
        title: 'Búsqueda',
        description: 'Encuentra películas, series y animes al instante.',
        borderRadius: 999,
      },
      {
        id: 'app-categories',
        selector: '[data-tour="app-categories"]',
        icon: 'categories',
        title: 'Categorías y +18',
        description: 'Explora géneros y la zona +18 con PIN.',
        borderRadius: 10,
      },
      {
        id: 'app-streaming',
        selector: '[data-tour="app-streaming"]',
        icon: 'streaming',
        title: 'Plataformas',
        description: 'Catálogos de Netflix, Disney+, Prime y Max.',
        borderRadius: 12,
      },
      {
        id: 'app-mylist',
        selector: '[data-tour="app-mylist-mobile"], [data-tour="app-mylist-desktop"]',
        icon: 'list',
        title: 'Mi Lista y Offline',
        description: 'Favoritos, historial y títulos sin conexión.',
        borderRadius: 10,
      },
      {
        id: 'app-install',
        selector: '[data-tour="app-install"]',
        icon: 'install',
        title: 'Descargar App',
        description: 'Instala MOVIX en tu pantalla de inicio.',
        borderRadius: 10,
      },
      {
        id: 'app-profile',
        selector: '[data-tour="app-profile"]',
        icon: 'profile',
        title: 'Perfil y Ajustes',
        description: 'Cuenta, idioma, alertas y este tutorial.',
        borderRadius: 999,
      },
      {
        id: 'app-mobile-nav',
        selector: '[data-tour="app-mobile-nav"]',
        icon: 'nav',
        title: 'Menú Rápido',
        description: 'Cambia entre Inicio, Series, Películas y Lista.',
        borderRadius: 12,
      },
    ];
  }

  return [
    {
      id: 'app-search',
      selector: '[data-tour="app-search"]',
      icon: 'search',
      title: 'Pesquisa',
      description: 'Busque filmes, séries, animes e doramas.',
      borderRadius: 999,
    },
    {
      id: 'app-categories',
      selector: '[data-tour="app-categories"]',
      icon: 'categories',
      title: 'Categorias e +18',
      description: 'Navegue por gêneros e área +18 com PIN.',
      borderRadius: 10,
    },
    {
      id: 'app-streaming',
      selector: '[data-tour="app-streaming"]',
      icon: 'streaming',
      title: 'Streamings',
      description: 'Catálogos da Netflix, Disney+, Prime, Max e mais.',
      borderRadius: 12,
    },
    {
      id: 'app-mylist',
      selector: '[data-tour="app-mylist-mobile"], [data-tour="app-mylist-desktop"]',
      icon: 'list',
      title: 'Lista e Offline',
      description: 'Favoritos salvos, histórico e modo sem internet.',
      borderRadius: 10,
    },
    {
      id: 'app-install',
      selector: '[data-tour="app-install"]',
      icon: 'install',
      title: 'Baixar App',
      description: 'Instale o MOVIX na tela inicial do aparelho.',
      borderRadius: 10,
    },
    {
      id: 'app-profile',
      selector: '[data-tour="app-profile"]',
      icon: 'profile',
      title: 'Perfil e Ajustes',
      description: 'Conta, idioma, notificações e este tutorial.',
      borderRadius: 999,
    },
    {
      id: 'app-mobile-nav',
      selector: '[data-tour="app-mobile-nav"]',
      icon: 'nav',
      title: 'Menu Rápido',
      description: 'Alterne entre Início, Séries, Filmes e Lista.',
      borderRadius: 12,
    },
  ];
}

export function getPlayerTourSteps(lang: SupportedLanguage): TourStep[] {
  const g = normalizeLangGroup(lang);

  if (g === 'en') {
    return [
      {
        id: 'player-cast',
        selector: '[data-tour="player-cast"]',
        icon: 'cast',
        title: 'Cast & Server',
        description: 'Switch HD server quickly if playback lags.',
        borderRadius: 999,
      },
      {
        id: 'player-display',
        selector: '[data-tour="player-display"]',
        icon: 'display',
        title: 'Screen & 360°',
        description: 'Aspect ratio, volume, brightness, mirror & 360°.',
        borderRadius: 999,
      },
      {
        id: 'player-lock',
        selector: '[data-tour="player-lock"]',
        icon: 'lock',
        title: 'Screen Lock',
        description: 'Lock controls against accidental touches.',
        borderRadius: 999,
      },
      {
        id: 'player-seek',
        selector: '[data-tour="player-seek"]',
        icon: 'seek',
        title: 'Play & ±10s',
        description: 'Play/pause or double-tap sides to skip ±10s.',
        borderRadius: 999,
      },
      {
        id: 'player-comments',
        selector: '[data-tour="player-comments"]',
        icon: 'comments',
        title: 'Live Comments',
        description: 'Show or hide floating on-screen reactions.',
        borderRadius: 999,
      },
      {
        id: 'player-speed',
        selector: '[data-tour="player-speed"]',
        icon: 'speed',
        title: 'Speed',
        description: 'Adjust playback speed from 0.5x to 2.0x.',
        borderRadius: 10,
      },
      {
        id: 'player-anthology',
        selector: '[data-tour="player-anthology"]',
        icon: 'anthology',
        title: 'Episodes',
        description: 'Pick seasons, episodes or related titles.',
        borderRadius: 10,
      },
      {
        id: 'player-pip',
        selector: '[data-tour="player-pip"]',
        icon: 'pip',
        title: 'Picture-in-Picture',
        description: 'Watch in a floating mini-window while using other apps.',
        borderRadius: 999,
      },
      {
        id: 'player-fullscreen',
        selector: '[data-tour="player-fullscreen"]',
        icon: 'fullscreen',
        title: 'Cinema Mode',
        description: 'Expand to full landscape cinema view.',
        borderRadius: 999,
      },
      {
        id: 'player-fav',
        selector: '[data-tour="player-fav"]',
        icon: 'like',
        title: 'Favorite',
        description: 'Save this title to your synced list.',
        borderRadius: 12,
      },
      {
        id: 'player-offline',
        selector: '[data-tour="player-offline"]',
        icon: 'download',
        title: 'Offline',
        description: 'Keep title details offline for 7 days.',
        borderRadius: 12,
      },
      {
        id: 'player-rotate-btn',
        selector: '[data-tour="player-rotate-btn"]',
        icon: 'rotate',
        title: '360° Rotation',
        description: 'Rotate video 0°–360° or flip screen.',
        borderRadius: 12,
      },
      {
        id: 'player-feedback',
        selector: '[data-tour="player-feedback"]',
        icon: 'feedback',
        title: 'Servers & Help',
        description: 'Switch mirror manually or report an issue.',
        borderRadius: 12,
      },
      {
        id: 'player-share',
        selector: '[data-tour="player-share"]',
        icon: 'share',
        title: 'Direct Share',
        description: 'Send a link straight to this movie.',
        borderRadius: 12,
      },
      {
        id: 'player-audio',
        selector: '[data-tour="player-audio"]',
        icon: 'audio',
        title: 'Audio & CC',
        description: 'Switch Dubbed, Subtitled and captions.',
        borderRadius: 12,
      },
      {
        id: 'player-gestures',
        selector: null,
        icon: 'gestures',
        title: 'Smart Gestures',
        description: 'Swipe left = brightness, right = volume, 2x tap = ±10s.',
      },
    ];
  }

  if (g === 'es') {
    return [
      {
        id: 'player-cast',
        selector: '[data-tour="player-cast"]',
        icon: 'cast',
        title: 'Transmitir',
        description: 'Cambia de servidor HD con un toque.',
        borderRadius: 999,
      },
      {
        id: 'player-display',
        selector: '[data-tour="player-display"]',
        icon: 'display',
        title: 'Pantalla y 360°',
        description: 'Formato, brillo, volumen, espejo y giro 360°.',
        borderRadius: 999,
      },
      {
        id: 'player-lock',
        selector: '[data-tour="player-lock"]',
        icon: 'lock',
        title: 'Bloquear Tela',
        description: 'Evita toques accidentales durante el video.',
        borderRadius: 999,
      },
      {
        id: 'player-seek',
        selector: '[data-tour="player-seek"]',
        icon: 'seek',
        title: 'Play y ±10s',
        description: 'Pausa o toca dos veces a los lados (±10s).',
        borderRadius: 999,
      },
      {
        id: 'player-comments',
        selector: '[data-tour="player-comments"]',
        icon: 'comments',
        title: 'Comentarios',
        description: 'Activa u oculta mensajes en pantalla.',
        borderRadius: 999,
      },
      {
        id: 'player-speed',
        selector: '[data-tour="player-speed"]',
        icon: 'speed',
        title: 'Velocidad',
        description: 'Controla el ritmo de 0.5x hasta 2.0x.',
        borderRadius: 10,
      },
      {
        id: 'player-anthology',
        selector: '[data-tour="player-anthology"]',
        icon: 'anthology',
        title: 'Episodios',
        description: 'Elige temporadas, episodios o similares.',
        borderRadius: 10,
      },
      {
        id: 'player-pip',
        selector: '[data-tour="player-pip"]',
        icon: 'pip',
        title: 'Picture-in-Picture',
        description: 'Abre el video en una ventana flotante mientras usas otras apps.',
        borderRadius: 999,
      },
      {
        id: 'player-fullscreen',
        selector: '[data-tour="player-fullscreen"]',
        icon: 'fullscreen',
        title: 'Modo Cine',
        description: 'Expande a pantalla completa horizontal.',
        borderRadius: 999,
      },
      {
        id: 'player-fav',
        selector: '[data-tour="player-fav"]',
        icon: 'like',
        title: 'Favoritos',
        description: 'Guarda este título en tu lista personal.',
        borderRadius: 12,
      },
      {
        id: 'player-offline',
        selector: '[data-tour="player-offline"]',
        icon: 'download',
        title: 'Offline',
        description: 'Guarda los datos por 7 días sin internet.',
        borderRadius: 12,
      },
      {
        id: 'player-rotate-btn',
        selector: '[data-tour="player-rotate-btn"]',
        icon: 'rotate',
        title: 'Giro 360°',
        description: 'Rota el video de 0° a 360° o invierte.',
        borderRadius: 12,
      },
      {
        id: 'player-feedback',
        selector: '[data-tour="player-feedback"]',
        icon: 'feedback',
        title: 'Servidores',
        description: 'Cambia de fuente o reporta un error.',
        borderRadius: 12,
      },
      {
        id: 'player-share',
        selector: '[data-tour="player-share"]',
        icon: 'share',
        title: 'Compartir',
        description: 'Enlace directo a esta película o episodio.',
        borderRadius: 12,
      },
      {
        id: 'player-audio',
        selector: '[data-tour="player-audio"]',
        icon: 'audio',
        title: 'Audio y CC',
        description: 'Cambia entre Doblado, Subtitulado y CC.',
        borderRadius: 12,
      },
      {
        id: 'player-gestures',
        selector: null,
        icon: 'gestures',
        title: 'Gestos Rápidos',
        description: 'Izquierda = brillo, derecha = volumen, 2x toque = ±10s.',
      },
    ];
  }

  return [
    {
      id: 'player-cast',
      selector: '[data-tour="player-cast"]',
      icon: 'cast',
      title: 'Transmitir',
      description: 'Troque de servidor HD com um toque.',
      borderRadius: 999,
    },
    {
      id: 'player-display',
      selector: '[data-tour="player-display"]',
      icon: 'display',
      title: 'Tela e 360°',
      description: 'Proporção, brilho, volume, espelho e 360°.',
      borderRadius: 999,
    },
    {
      id: 'player-lock',
      selector: '[data-tour="player-lock"]',
      icon: 'lock',
      title: 'Travar Tela',
      description: 'Bloqueia botões contra toques acidentais.',
      borderRadius: 999,
    },
    {
      id: 'player-seek',
      selector: '[data-tour="player-seek"]',
      icon: 'seek',
      title: 'Play e ±10s',
      description: 'Pause ou dê 2 toques nas laterais (±10s).',
      borderRadius: 999,
    },
    {
      id: 'player-comments',
      selector: '[data-tour="player-comments"]',
      icon: 'comments',
      title: 'Comentários',
      description: 'Ative ou oculte comentários ao vivo.',
      borderRadius: 999,
    },
    {
      id: 'player-speed',
      selector: '[data-tour="player-speed"]',
      icon: 'speed',
      title: 'Velocidade',
      description: 'Ajuste o ritmo de 0.5x até 2.0x.',
      borderRadius: 10,
    },
    {
      id: 'player-anthology',
      selector: '[data-tour="player-anthology"]',
      icon: 'anthology',
      title: 'Antologia',
      description: 'Troque temporadas, episódios e parecidos.',
      borderRadius: 10,
    },
    {
      id: 'player-pip',
      selector: '[data-tour="player-pip"]',
      icon: 'pip',
      title: 'Picture-in-Picture',
      description: 'Abre o vídeo em janela flutuante para assistir enquanto usa outros apps.',
      borderRadius: 999,
    },
    {
      id: 'player-fullscreen',
      selector: '[data-tour="player-fullscreen"]',
      icon: 'fullscreen',
      title: 'Modo Cinema',
      description: 'Expande o player em tela cheia horizontal.',
      borderRadius: 999,
    },
    {
      id: 'player-fav',
      selector: '[data-tour="player-fav"]',
      icon: 'like',
      title: 'Gostar',
      description: 'Salva este título na sua lista pessoal.',
      borderRadius: 12,
    },
    {
      id: 'player-offline',
      selector: '[data-tour="player-offline"]',
      icon: 'download',
      title: 'Offline',
      description: 'Guarda os dados por 7 dias sem internet.',
      borderRadius: 12,
    },
    {
      id: 'player-rotate-btn',
      selector: '[data-tour="player-rotate-btn"]',
      icon: 'rotate',
      title: 'Rotação 360°',
      description: 'Gire a tela de 0° a 360° ou espelhe.',
      borderRadius: 12,
    },
    {
      id: 'player-feedback',
      selector: '[data-tour="player-feedback"]',
      icon: 'feedback',
      title: 'Servidores',
      description: 'Troque a fonte ou relate problemas.',
      borderRadius: 12,
    },
    {
      id: 'player-share',
      selector: '[data-tour="player-share"]',
      icon: 'share',
      title: 'Compartilhar',
      description: 'Envia link direto para este filme.',
      borderRadius: 12,
    },
    {
      id: 'player-audio',
      selector: '[data-tour="player-audio"]',
      icon: 'audio',
      title: 'Áudio e CC',
      description: 'Alterne Dublado, Legendado e legendas.',
      borderRadius: 12,
    },
    {
      id: 'player-gestures',
      selector: null,
      icon: 'gestures',
      title: 'Gestos Rápidos',
      description: 'Esquerda = brilho, direita = volume, 2x toque = ±10s.',
    },
  ];
}
