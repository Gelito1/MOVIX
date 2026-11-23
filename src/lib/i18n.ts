import type { SupportedLanguage } from './firebase';

export const TMDB_LANGUAGE_MAP: Record<SupportedLanguage, string> = {
  'pt-BR': 'pt-BR',
  'pt-PT': 'pt-PT',
  en: 'en-US',
  'es-419': 'es-MX',
  'es-ES': 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
};

export interface Translations {
  // Navigation & Header
  searchPlaceholder: string;
  home: string;
  movies: string;
  series: string;
  animes: string;
  novelas: string;
  doramas: string;
  dramas: string;
  kids: string;
  documentaries: string;
  myList: string;
  listShort: string;
  installApp: string;
  profile: string;
  loading: string;
  viewAll: string;

  // Home Page
  recommendedForYou: string;
  continueWatching: string;
  manageHistory: string;
  featuredHighlights: string;
  latestReleases: string;
  exploreMore: string;
  watchedPct: string;

  // Onboarding Terms (Compact & Clean)
  termsTitle: string;
  termsBody: string;
  termsCheckboxPrefix: string;
  termsOfUse: string;
  andWord: string;
  privacyPolicy: string;
  legalNotice: string;
  agreeAndContinue: string;
  mustAcceptTerms: string;

  // Auth / Single Account per Device
  createOrSignIn: string;
  deviceBoundTitle: string;
  deviceBoundHint: string;
  oneAccountPerDeviceError: string;
  enterAccount: string;
  signInButton: string;
  continueWithGoogle: string;
  createWithEmail: string;
  exploreLater: string;
  signInTitle: string;
  createAccountTitle: string;
  recoverPasswordTitle: string;
  emailLabel: string;
  passwordLabel: string;
  confirmPasswordLabel: string;
  nameLabel: string;
  namePlaceholder: string;
  showPasswords: string;
  forgotPassword: string;
  createNewAccount: string;
  alreadyHaveAccount: string;
  sendResetLink: string;
  resetLinkSent: string;
  help: string;

  // Profile Modal (Clean & Minimal)
  myProfile: string;
  language: string;
  notifications: string;
  notificationsOn: string;
  notificationsOff: string;
  activate: string;
  active: string;
  termsAndPrivacy: string;
  signOut: string;
  verifyEmailNotice: string;
  verifiedCheckBtn: string;
  resendLinkBtn: string;
  connectedGoogle: string;
  connectedEmail: string;
  ok: string;
  close: string;

  // Player & Watch UI
  introduction: string;
  like: string;
  liked: string;
  download: string;
  savedOffline: string;
  feedback: string;
  share: string;
  copied: string;
  audioLanguage: string;
  subtitled: string;
  dubbed: string;
  youMayLike: string;
  episodes: string;
  rotate360: string;
  resetRotation: string;
  mirrorScreen: string;
  lockControls: string;
  unlockControls: string;
  playbackSpeed: string;
  fitScreen: string;
  fillScreen: string;
  directLinkCopied: string;
  watchNow: string;
  watchTrailer: string;
  addToList: string;
  inMyList: string;
  watchOffline: string;
  back: string;
  aspectDefault: string;
  aspectFull: string;
  brightness: string;
  volumeLabel: string;
  playlistTitle: string;
  anthology: string;
  speedShort: string;
  commentPlaceholder: string;
  commentsOn: string;
  commentsOff: string;
  landscapeMode: string;
  nextEpisode: string;

  // Ads & Sponsored UI
  sponsored: string;
  sponsoredAd: string;
  learnMore: string;
  closeAd: string;
  openAd: string;
  unmuteAd: string;
  muteAd: string;
  skipAd: string;
  skipAdIn: string;

  // Player PiP & Background Audio Guard
  pipActive: string;
  pipRestored: string;
  pipClosed: string;
  pipPlayingInWindow: string;
  pipBringBack: string;
  bgPausedTitle: string;
  bgPausedHint: string;
  resumeWatching: string;
}

const PT_BASE: Translations = {
  searchPlaceholder: 'Pesquisar filmes, séries, doramas, animes...',
  home: 'Início',
  movies: 'Filmes',
  series: 'Séries',
  animes: 'Animes',
  novelas: 'Novelas',
  doramas: 'Doramas',
  dramas: 'Dramas',
  kids: 'Infantil',
  documentaries: 'Documentários',
  myList: 'Minha Lista',
  listShort: 'Lista',
  installApp: 'Baixar App',
  profile: 'Perfil',
  loading: 'A carregar...',
  viewAll: 'Ver tudo',

  recommendedForYou: 'Recomendados para Você',
  continueWatching: 'Continuar Assistindo',
  manageHistory: 'Gerir histórico',
  featuredHighlights: 'Destaques Selecionados',
  latestReleases: 'Últimos Lançamentos',
  exploreMore: 'Explorar Mais Títulos',
  watchedPct: 'visto',

  termsTitle: 'Termos e Condições',
  termsBody:
    'O MOVIX organiza e reproduz filmes e séries a partir de fontes externas integradas, sem hospedar arquivos próprios. Seus dados de conta seguem a LGPD e cada dispositivo aceita apenas uma conta.',
  termsCheckboxPrefix: 'Concordo com os',
  termsOfUse: 'Termos de Uso',
  andWord: 'e a',
  privacyPolicy: 'Política de Privacidade',
  legalNotice: 'Aviso Legal',
  agreeAndContinue: 'Concordar e Prosseguir',
  mustAcceptTerms: 'Aceite os termos para prosseguir.',

  createOrSignIn: 'Acesse o MOVIX',
  deviceBoundTitle: 'Conta deste dispositivo',
  deviceBoundHint: 'Este dispositivo aceita apenas uma conta vinculada.',
  oneAccountPerDeviceError:
    'Este dispositivo já está vinculado a outra conta. Cada dispositivo aceita apenas uma conta.',
  enterAccount: 'Entrar',
  signInButton: 'Iniciar sessão',
  continueWithGoogle: 'Continuar com Google',
  createWithEmail: 'Criar conta com E-mail',
  exploreLater: 'Entrar depois',
  signInTitle: 'Iniciar sessão',
  createAccountTitle: 'Criar conta',
  recoverPasswordTitle: 'Recuperar senha',
  emailLabel: 'E-mail',
  passwordLabel: 'Senha',
  confirmPasswordLabel: 'Confirmar senha',
  nameLabel: 'Nome',
  namePlaceholder: 'Seu nome',
  showPasswords: 'Mostrar senha',
  forgotPassword: 'Esqueci a senha',
  createNewAccount: 'Criar conta',
  alreadyHaveAccount: 'Já tem conta?',
  sendResetLink: 'Enviar link',
  resetLinkSent: 'Link de recuperação enviado para o seu e-mail.',
  help: 'Ajuda',

  myProfile: 'Perfil',
  language: 'Idioma',
  notifications: 'Notificações',
  notificationsOn: 'Ativadas',
  notificationsOff: 'Desativadas',
  activate: 'Ativar',
  active: 'Ativo',
  termsAndPrivacy: 'Termos e Privacidade',
  signOut: 'Sair da conta',
  verifyEmailNotice: 'Confirme seu e-mail para sincronizar favoritos na nuvem.',
  verifiedCheckBtn: 'Já confirmei',
  resendLinkBtn: 'Reenviar',
  connectedGoogle: 'Google',
  connectedEmail: 'E-mail',
  ok: 'Ok',
  close: 'Fechar',

  introduction: 'Introdução',
  like: 'Gostar',
  liked: 'Gostei',
  download: 'Download',
  savedOffline: 'Salvo',
  feedback: 'Feedback',
  share: 'Compartilhar',
  copied: 'Copiado',
  audioLanguage: 'Linguagem',
  subtitled: 'Legendado',
  dubbed: 'Dublado',
  youMayLike: 'Você vai gostar',
  episodes: 'Episódios',
  rotate360: 'Rotação 360°',
  resetRotation: 'Redefinir',
  mirrorScreen: 'Espelhar',
  lockControls: 'Bloquear tela',
  unlockControls: 'Desbloquear',
  playbackSpeed: 'Velocidade',
  fitScreen: 'Ajustar',
  fillScreen: 'Preencher',
  directLinkCopied: 'Link direto do filme copiado!',
  watchNow: 'Assistir Agora',
  watchTrailer: 'Ver Trailer',
  addToList: 'Adicionar à Lista',
  inMyList: 'Na Minha Lista',
  watchOffline: 'Assistir Offline',
  back: 'Voltar',
  aspectDefault: 'Padrão',
  aspectFull: 'Completo',
  brightness: 'Brilho',
  volumeLabel: 'Volume',
  playlistTitle: 'Lista de reprodução',
  anthology: 'Antologia',
  speedShort: 'Speed',
  commentPlaceholder: 'Insira um comentário...',
  commentsOn: 'Comentários ativados',
  commentsOff: 'Comentários ocultos',
  landscapeMode: 'Modo Paisagem',
  nextEpisode: 'Próximo Episódio',

  sponsored: 'Patrocinado',
  sponsoredAd: 'Anúncio patrocinado',
  learnMore: 'Saiba mais',
  closeAd: 'Fechar anúncio',
  openAd: 'Abrir anúncio',
  unmuteAd: 'Ativar som',
  muteAd: 'Silenciar',
  skipAd: 'Pular anúncio',
  skipAdIn: 'Pular em',

  pipActive: 'Modo Picture-in-Picture ativo',
  pipRestored: 'Player restaurado',
  pipClosed: 'Picture-in-Picture encerrado',
  pipPlayingInWindow: 'Reproduzindo em Picture-in-Picture',
  pipBringBack: 'Trazer vídeo de volta',
  bgPausedTitle: 'Reprodução pausada fora do aplicativo',
  bgPausedHint: 'O som foi interrompido automaticamente ao sair do MOVIX.',
  resumeWatching: 'Continuar assistindo',
};

const EN_BASE: Translations = {
  searchPlaceholder: 'Search movies, series, dramas, anime...',
  home: 'Home',
  movies: 'Movies',
  series: 'Series',
  animes: 'Anime',
  novelas: 'Soap Operas',
  doramas: 'K-Dramas',
  dramas: 'Dramas',
  kids: 'Kids',
  documentaries: 'Documentaries',
  myList: 'My List',
  listShort: 'List',
  installApp: 'Get App',
  profile: 'Profile',
  loading: 'Loading...',
  viewAll: 'View all',

  recommendedForYou: 'Recommended for You',
  continueWatching: 'Continue Watching',
  manageHistory: 'Manage history',
  featuredHighlights: 'Featured Picks',
  latestReleases: 'Latest Releases',
  exploreMore: 'Explore More Titles',
  watchedPct: 'watched',

  termsTitle: 'Terms & Conditions',
  termsBody:
    'MOVIX organizes and plays movies and series from integrated external sources without hosting media files locally. Your account data is protected and each device allows only one account.',
  termsCheckboxPrefix: 'I agree to the',
  termsOfUse: 'Terms of Use',
  andWord: 'and',
  privacyPolicy: 'Privacy Policy',
  legalNotice: 'Legal Notice',
  agreeAndContinue: 'Agree & Continue',
  mustAcceptTerms: 'Accept the terms to continue.',

  createOrSignIn: 'Access MOVIX',
  deviceBoundTitle: 'Device Account',
  deviceBoundHint: 'Only one account is allowed per device.',
  oneAccountPerDeviceError:
    'This device is already linked to another account. Only one account per device is allowed.',
  enterAccount: 'Sign In',
  signInButton: 'Sign in',
  continueWithGoogle: 'Continue with Google',
  createWithEmail: 'Create account with Email',
  exploreLater: 'Skip for now',
  signInTitle: 'Sign in',
  createAccountTitle: 'Create account',
  recoverPasswordTitle: 'Reset password',
  emailLabel: 'Email',
  passwordLabel: 'Password',
  confirmPasswordLabel: 'Confirm password',
  nameLabel: 'Name',
  namePlaceholder: 'Your name',
  showPasswords: 'Show password',
  forgotPassword: 'Forgot password',
  createNewAccount: 'Create account',
  alreadyHaveAccount: 'Already have an account?',
  sendResetLink: 'Send reset link',
  resetLinkSent: 'Password reset link sent to your email.',
  help: 'Help',

  myProfile: 'Profile',
  language: 'Language',
  notifications: 'Notifications',
  notificationsOn: 'Enabled',
  notificationsOff: 'Disabled',
  activate: 'Enable',
  active: 'On',
  termsAndPrivacy: 'Terms & Privacy',
  signOut: 'Sign out',
  verifyEmailNotice: 'Verify your email to sync favorites to the cloud.',
  verifiedCheckBtn: 'I verified',
  resendLinkBtn: 'Resend',
  connectedGoogle: 'Google',
  connectedEmail: 'Email',
  ok: 'Ok',
  close: 'Close',

  introduction: 'Overview',
  like: 'Like',
  liked: 'Liked',
  download: 'Download',
  savedOffline: 'Saved',
  feedback: 'Feedback',
  share: 'Share',
  copied: 'Copied',
  audioLanguage: 'Language',
  subtitled: 'Subtitled',
  dubbed: 'Dubbed',
  youMayLike: 'You may like',
  episodes: 'Episodes',
  rotate360: '360° Rotation',
  resetRotation: 'Reset',
  mirrorScreen: 'Mirror',
  lockControls: 'Lock screen',
  unlockControls: 'Unlock',
  playbackSpeed: 'Speed',
  fitScreen: 'Fit',
  fillScreen: 'Fill',
  directLinkCopied: 'Direct movie link copied!',
  watchNow: 'Watch Now',
  watchTrailer: 'Watch Trailer',
  addToList: 'Add to List',
  inMyList: 'In My List',
  watchOffline: 'Watch Offline',
  back: 'Back',
  aspectDefault: 'Default',
  aspectFull: 'Full',
  brightness: 'Brightness',
  volumeLabel: 'Volume',
  playlistTitle: 'Playlist',
  anthology: 'Episodes',
  speedShort: 'Speed',
  commentPlaceholder: 'Write a live comment...',
  commentsOn: 'On-screen comments on',
  commentsOff: 'On-screen comments off',
  landscapeMode: 'Landscape Mode',
  nextEpisode: 'Next Episode',

  sponsored: 'Sponsored',
  sponsoredAd: 'Sponsored ad',
  learnMore: 'Learn more',
  closeAd: 'Close ad',
  openAd: 'Open ad',
  unmuteAd: 'Unmute',
  muteAd: 'Mute',
  skipAd: 'Skip ad',
  skipAdIn: 'Skip in',

  pipActive: 'Picture-in-Picture active',
  pipRestored: 'Player restored',
  pipClosed: 'Picture-in-Picture closed',
  pipPlayingInWindow: 'Playing in Picture-in-Picture',
  pipBringBack: 'Bring video back',
  bgPausedTitle: 'Playback paused outside the app',
  bgPausedHint: 'Audio was stopped automatically when leaving MOVIX.',
  resumeWatching: 'Resume watching',
};

const ES_BASE: Translations = {
  searchPlaceholder: 'Buscar películas, series, doramas, anime...',
  home: 'Inicio',
  movies: 'Películas',
  series: 'Series',
  animes: 'Anime',
  novelas: 'Novelas',
  doramas: 'Doramas',
  dramas: 'Dramas',
  kids: 'Infantil',
  documentaries: 'Documentales',
  myList: 'Mi Lista',
  listShort: 'Lista',
  installApp: 'Descargar App',
  profile: 'Perfil',
  loading: 'Cargando...',
  viewAll: 'Ver todo',

  recommendedForYou: 'Recomendados para Ti',
  continueWatching: 'Seguir Viendo',
  manageHistory: 'Gestionar historial',
  featuredHighlights: 'Destacados',
  latestReleases: 'Últimos Estrenos',
  exploreMore: 'Explorar Más Títulos',
  watchedPct: 'visto',

  termsTitle: 'Términos y Condiciones',
  termsBody:
    'MOVIX organiza y reproduce películas y series desde fuentes externas integradas sin alojar archivos propios. Tus datos están protegidos y cada dispositivo acepta solo una cuenta.',
  termsCheckboxPrefix: 'Acepto los',
  termsOfUse: 'Términos de Uso',
  andWord: 'y la',
  privacyPolicy: 'Política de Privacidad',
  legalNotice: 'Aviso Legal',
  agreeAndContinue: 'Aceptar y Continuar',
  mustAcceptTerms: 'Acepta los términos para continuar.',

  createOrSignIn: 'Acceder a MOVIX',
  deviceBoundTitle: 'Cuenta de este dispositivo',
  deviceBoundHint: 'Cada dispositivo acepta solo una cuenta vinculada.',
  oneAccountPerDeviceError:
    'Este dispositivo ya está vinculado a otra cuenta. Solo se permite una cuenta por dispositivo.',
  enterAccount: 'Entrar',
  signInButton: 'Iniciar sesión',
  continueWithGoogle: 'Continuar con Google',
  createWithEmail: 'Crear cuenta con E-mail',
  exploreLater: 'Entrar después',
  signInTitle: 'Iniciar sesión',
  createAccountTitle: 'Crear cuenta',
  recoverPasswordTitle: 'Recuperar contraseña',
  emailLabel: 'Correo electrónico',
  passwordLabel: 'Contraseña',
  confirmPasswordLabel: 'Confirmar contraseña',
  nameLabel: 'Nombre',
  namePlaceholder: 'Tu nombre',
  showPasswords: 'Mostrar contraseña',
  forgotPassword: 'Olvidé mi contraseña',
  createNewAccount: 'Crear cuenta',
  alreadyHaveAccount: '¿Ya tienes cuenta?',
  sendResetLink: 'Enviar enlace',
  resetLinkSent: 'Enlace de recuperación enviado a tu correo.',
  help: 'Ayuda',

  myProfile: 'Perfil',
  language: 'Idioma',
  notifications: 'Notificaciones',
  notificationsOn: 'Activadas',
  notificationsOff: 'Desactivadas',
  activate: 'Activar',
  active: 'Activo',
  termsAndPrivacy: 'Términos y Privacidad',
  signOut: 'Cerrar sesión',
  verifyEmailNotice: 'Verifica tu correo para sincronizar favoritos en la nube.',
  verifiedCheckBtn: 'Ya verifiqué',
  resendLinkBtn: 'Reenviar',
  connectedGoogle: 'Google',
  connectedEmail: 'E-mail',
  ok: 'Ok',
  close: 'Cerrar',

  introduction: 'Introducción',
  like: 'Me gusta',
  liked: 'Guardado',
  download: 'Descargar',
  savedOffline: 'Guardado',
  feedback: 'Comentarios',
  share: 'Compartir',
  copied: 'Copiado',
  audioLanguage: 'Idioma',
  subtitled: 'Subtitulado',
  dubbed: 'Doblado',
  youMayLike: 'Te puede gustar',
  episodes: 'Episodios',
  rotate360: 'Rotación 360°',
  resetRotation: 'Restablecer',
  mirrorScreen: 'Espejar',
  lockControls: 'Bloquear pantalla',
  unlockControls: 'Desbloquear',
  playbackSpeed: 'Velocidad',
  fitScreen: 'Ajustar',
  fillScreen: 'Llenar',
  directLinkCopied: '¡Enlace directo copiado!',
  watchNow: 'Ver Ahora',
  watchTrailer: 'Ver Tráiler',
  addToList: 'Añadir a Mi Lista',
  inMyList: 'En Mi Lista',
  watchOffline: 'Ver Sin Conexión',
  back: 'Volver',
  aspectDefault: 'Estándar',
  aspectFull: 'Completo',
  brightness: 'Brillo',
  volumeLabel: 'Volumen',
  playlistTitle: 'Lista de reproducción',
  anthology: 'Antología',
  speedShort: 'Velocidad',
  commentPlaceholder: 'Escribe un comentario...',
  commentsOn: 'Comentarios activados',
  commentsOff: 'Comentarios ocultos',
  landscapeMode: 'Modo Horizontal',
  nextEpisode: 'Siguiente Episodio',

  sponsored: 'Patrocinado',
  sponsoredAd: 'Anuncio patrocinado',
  learnMore: 'Más información',
  closeAd: 'Cerrar anuncio',
  openAd: 'Abrir anuncio',
  unmuteAd: 'Activar sonido',
  muteAd: 'Silenciar',
  skipAd: 'Saltar anuncio',
  skipAdIn: 'Saltar en',

  pipActive: 'Modo Picture-in-Picture activo',
  pipRestored: 'Reproductor restaurado',
  pipClosed: 'Picture-in-Picture cerrado',
  pipPlayingInWindow: 'Reproduciendo en Picture-in-Picture',
  pipBringBack: 'Traer vídeo de vuelta',
  bgPausedTitle: 'Reproducción pausada fuera de la app',
  bgPausedHint: 'El sonido se detuvo automáticamente al salir de MOVIX.',
  resumeWatching: 'Seguir viendo',
};

const FR_BASE: Translations = {
  searchPlaceholder: 'Rechercher films, séries, dramas, anime...',
  home: 'Accueil',
  movies: 'Films',
  series: 'Séries',
  animes: 'Anime',
  novelas: 'Feuilletons',
  doramas: 'K-Dramas',
  dramas: 'Drames',
  kids: 'Enfants',
  documentaries: 'Documentaires',
  myList: 'Ma Liste',
  listShort: 'Liste',
  installApp: "Installer l'App",
  profile: 'Profil',
  loading: 'Chargement...',
  viewAll: 'Tout voir',

  recommendedForYou: 'Recommandés pour Vous',
  continueWatching: 'Reprendre la Lecture',
  manageHistory: "Gérer l'historique",
  featuredHighlights: 'Sélection',
  latestReleases: 'Dernières Sorties',
  exploreMore: 'Explorer Plus',
  watchedPct: 'vu',

  termsTitle: 'Conditions Générales',
  termsBody:
    'MOVIX organise et lit des films et séries à partir de sources externes sans héberger de fichiers vidéo. Vos données sont protégées et chaque appareil n’accepte qu’un seul compte.',
  termsCheckboxPrefix: "J'accepte les",
  termsOfUse: "Conditions d'utilisation",
  andWord: 'et la',
  privacyPolicy: 'Politique de confidentialité',
  legalNotice: 'Mentions légales',
  agreeAndContinue: 'Accepter et Continuer',
  mustAcceptTerms: 'Veuillez accepter les conditions pour continuer.',

  createOrSignIn: 'Accéder à MOVIX',
  deviceBoundTitle: 'Compte de cet appareil',
  deviceBoundHint: 'Un seul compte est autorisé par appareil.',
  oneAccountPerDeviceError:
    'Cet appareil est déjà lié à un autre compte. Un seul compte par appareil est autorisé.',
  enterAccount: 'Se connecter',
  signInButton: 'Se connecter',
  continueWithGoogle: 'Continuer avec Google',
  createWithEmail: 'Créer un compte par E-mail',
  exploreLater: 'Plus tard',
  signInTitle: 'Connexion',
  createAccountTitle: 'Créer un compte',
  recoverPasswordTitle: 'Mot de passe oublié',
  emailLabel: 'E-mail',
  passwordLabel: 'Mot de passe',
  confirmPasswordLabel: 'Confirmer le mot de passe',
  nameLabel: 'Nom',
  namePlaceholder: 'Votre nom',
  showPasswords: 'Afficher le mot de passe',
  forgotPassword: 'Mot de passe oublié',
  createNewAccount: 'Créer un compte',
  alreadyHaveAccount: 'Déjà un compte ?',
  sendResetLink: 'Envoyer le lien',
  resetLinkSent: 'Lien de réinitialisation envoyé par e-mail.',
  help: 'Aide',

  myProfile: 'Profil',
  language: 'Langue',
  notifications: 'Notifications',
  notificationsOn: 'Activées',
  notificationsOff: 'Désactivées',
  activate: 'Activer',
  active: 'Actif',
  termsAndPrivacy: 'Conditions & Confidentialité',
  signOut: 'Se déconnecter',
  verifyEmailNotice: 'Vérifiez votre e-mail pour synchroniser vos favoris.',
  verifiedCheckBtn: "J'ai vérifié",
  resendLinkBtn: 'Renvoyer',
  connectedGoogle: 'Google',
  connectedEmail: 'E-mail',
  ok: 'Ok',
  close: 'Fermer',

  introduction: 'Synopsis',
  like: 'Aimer',
  liked: 'Aimé',
  download: 'Télécharger',
  savedOffline: 'Enregistré',
  feedback: 'Avis',
  share: 'Partager',
  copied: 'Copié',
  audioLanguage: 'Langue',
  subtitled: 'Sous-titré',
  dubbed: 'Doublé',
  youMayLike: 'Vous aimerez aussi',
  episodes: 'Épisodes',
  rotate360: 'Rotation 360°',
  resetRotation: 'Réinitialiser',
  mirrorScreen: 'Miroir',
  lockControls: 'Verrouiller',
  unlockControls: 'Déverrouiller',
  playbackSpeed: 'Vitesse',
  fitScreen: 'Adapter',
  fillScreen: 'Remplir',
  directLinkCopied: 'Lien direct copié !',
  watchNow: 'Regarder',
  watchTrailer: 'Bande-annonce',
  addToList: 'Ajouter à ma liste',
  inMyList: 'Dans ma liste',
  watchOffline: 'Hors ligne',
  back: 'Retour',
  aspectDefault: 'Standard',
  aspectFull: 'Complet',
  brightness: 'Luminosité',
  volumeLabel: 'Volume',
  playlistTitle: 'Liste de lecture',
  anthology: 'Épisodes',
  speedShort: 'Vitesse',
  commentPlaceholder: 'Écrire un commentaire...',
  commentsOn: 'Commentaires activés',
  commentsOff: 'Commentaires masqués',
  landscapeMode: 'Mode Paysage',
  nextEpisode: 'Épisode Suivant',

  sponsored: 'Sponsorisé',
  sponsoredAd: 'Annonce sponsorisée',
  learnMore: 'En savoir plus',
  closeAd: "Fermer l'annonce",
  openAd: "Ouvrir l'annonce",
  unmuteAd: 'Activer le son',
  muteAd: 'Couper le son',
  skipAd: "Passer l'annonce",
  skipAdIn: 'Passer dans',

  pipActive: 'Mode Picture-in-Picture actif',
  pipRestored: 'Lecteur restauré',
  pipClosed: 'Picture-in-Picture fermé',
  pipPlayingInWindow: 'Lecture en Picture-in-Picture',
  pipBringBack: 'Ramener la vidéo',
  bgPausedTitle: "Lecture en pause hors de l'application",
  bgPausedHint: 'Le son a été coupé automatiquement en quittant MOVIX.',
  resumeWatching: 'Reprendre la lecture',
};

const IT_BASE: Translations = {
  searchPlaceholder: 'Cerca film, serie, drama, anime...',
  home: 'Home',
  movies: 'Film',
  series: 'Serie',
  animes: 'Anime',
  novelas: 'Telenovele',
  doramas: 'K-Drama',
  dramas: 'Drammatici',
  kids: 'Bambini',
  documentaries: 'Documentari',
  myList: 'La Mia Lista',
  listShort: 'Lista',
  installApp: 'Scarica App',
  profile: 'Profilo',
  loading: 'Caricamento...',
  viewAll: 'Vedi tutto',

  recommendedForYou: 'Consigliati per Te',
  continueWatching: 'Continua a Guardare',
  manageHistory: 'Gestisci cronologia',
  featuredHighlights: 'In Evidenza',
  latestReleases: 'Ultime Uscite',
  exploreMore: 'Esplora Altri Titoli',
  watchedPct: 'visto',

  termsTitle: 'Termini e Condizioni',
  termsBody:
    'MOVIX organizza e riproduce film e serie da fonti esterne integrate senza ospitare file video propri. I tuoi dati sono protetti e ogni dispositivo accetta un solo account.',
  termsCheckboxPrefix: 'Accetto i',
  termsOfUse: "Termini d'Uso",
  andWord: 'e la',
  privacyPolicy: 'Informativa sulla Privacy',
  legalNotice: 'Note Legali',
  agreeAndContinue: 'Accetta e Continua',
  mustAcceptTerms: 'Accetta i termini per continuare.',

  createOrSignIn: 'Accedi a MOVIX',
  deviceBoundTitle: 'Account del dispositivo',
  deviceBoundHint: 'È consentito un solo account per dispositivo.',
  oneAccountPerDeviceError:
    'Questo dispositivo è già collegato a un altro account. È consentito un solo account per dispositivo.',
  enterAccount: 'Accedi',
  signInButton: 'Accedi',
  continueWithGoogle: 'Continua con Google',
  createWithEmail: 'Crea account con E-mail',
  exploreLater: 'Più tardi',
  signInTitle: 'Accedi',
  createAccountTitle: 'Crea account',
  recoverPasswordTitle: 'Recupera password',
  emailLabel: 'E-mail',
  passwordLabel: 'Password',
  confirmPasswordLabel: 'Conferma password',
  nameLabel: 'Nome',
  namePlaceholder: 'Il tuo nome',
  showPasswords: 'Mostra password',
  forgotPassword: 'Password dimenticata',
  createNewAccount: 'Crea account',
  alreadyHaveAccount: 'Hai già un account?',
  sendResetLink: 'Invia link',
  resetLinkSent: 'Link di ripristino inviato alla tua e-mail.',
  help: 'Aiuto',

  myProfile: 'Profilo',
  language: 'Lingua',
  notifications: 'Notifiche',
  notificationsOn: 'Attive',
  notificationsOff: 'Disattive',
  activate: 'Attiva',
  active: 'Attivo',
  termsAndPrivacy: 'Termini e Privacy',
  signOut: 'Esci',
  verifyEmailNotice: 'Verifica la tua e-mail per sincronizzare i preferiti.',
  verifiedCheckBtn: 'Ho verificato',
  resendLinkBtn: 'Invia di nuovo',
  connectedGoogle: 'Google',
  connectedEmail: 'E-mail',
  ok: 'Ok',
  close: 'Chiudi',

  introduction: 'Trama',
  like: 'Mi piace',
  liked: 'Salvato',
  download: 'Scarica',
  savedOffline: 'Salvato',
  feedback: 'Feedback',
  share: 'Condividi',
  copied: 'Copiato',
  audioLanguage: 'Lingua',
  subtitled: 'Sottotitolato',
  dubbed: 'Doppiato',
  youMayLike: 'Potrebbe piacerti',
  episodes: 'Episodi',
  rotate360: 'Rotazione 360°',
  resetRotation: 'Ripristina',
  mirrorScreen: 'Specchia',
  lockControls: 'Blocca schermo',
  unlockControls: 'Sblocca',
  playbackSpeed: 'Velocità',
  fitScreen: 'Adatta',
  fillScreen: 'Riempi',
  directLinkCopied: 'Link diretto copiato!',
  watchNow: 'Guarda Ora',
  watchTrailer: 'Guarda Trailer',
  addToList: 'Aggiungi alla Lista',
  inMyList: 'Nella Mia Lista',
  watchOffline: 'Guarda Offline',
  back: 'Indietro',
  aspectDefault: 'Predefinito',
  aspectFull: 'Completo',
  brightness: 'Luminosità',
  volumeLabel: 'Volume',
  playlistTitle: 'Playlist',
  anthology: 'Episodi',
  speedShort: 'Velocità',
  commentPlaceholder: 'Scrivi un commento...',
  commentsOn: 'Commenti attivi',
  commentsOff: 'Commenti nascosti',
  landscapeMode: 'Modalità Orizzontale',
  nextEpisode: 'Prossimo Episodio',

  sponsored: 'Sponsorizzato',
  sponsoredAd: 'Annuncio sponsorizzato',
  learnMore: 'Scopri di più',
  closeAd: 'Chiudi annuncio',
  openAd: 'Apri annuncio',
  unmuteAd: 'Attiva audio',
  muteAd: 'Silenzia',
  skipAd: 'Salta annuncio',
  skipAdIn: 'Salta tra',

  pipActive: 'Modalità Picture-in-Picture attiva',
  pipRestored: 'Player ripristinato',
  pipClosed: 'Picture-in-Picture chiuso',
  pipPlayingInWindow: 'Riproduzione in Picture-in-Picture',
  pipBringBack: 'Riporta il video qui',
  bgPausedTitle: "Riproduzione in pausa fuori dall'app",
  bgPausedHint: "L'audio è stato interrotto automaticamente uscendo da MOVIX.",
  resumeWatching: 'Riprendi visione',
};

const DICTIONARIES: Record<SupportedLanguage, Translations> = {
  'pt-BR': PT_BASE,
  'pt-PT': {
    ...PT_BASE,
    continueWatching: 'Continuar a Ver',
    recommendedForYou: 'Recomendados para Si',
    share: 'Partilhar',
    dubbed: 'Dobrado',
    youMayLike: 'Vai gostar',
    skipAd: 'Saltar anúncio',
    skipAdIn: 'Saltar em',
    resumeWatching: 'Continuar a ver',
  },
  en: EN_BASE,
  'es-419': ES_BASE,
  'es-ES': {
    ...ES_BASE,
    recommendedForYou: 'Recomendados para Ti',
    continueWatching: 'Seguir Viendo',
  },
  fr: FR_BASE,
  it: IT_BASE,
};

export function getTranslations(lang: SupportedLanguage): Translations {
  return DICTIONARIES[lang] || PT_BASE;
}

export function getTmdbLanguageCode(lang: SupportedLanguage): string {
  return TMDB_LANGUAGE_MAP[lang] || 'pt-BR';
}
