import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AccountModal } from './components/AccountModal';
import { BrandMark } from './components/BrandMark';
import { CategoryRibbon } from './components/CategoryRibbon';
import { GuidedSpotlightTour } from './components/GuidedSpotlightTour';
import { Header } from './components/Header';
import { LegalDocsModal, type LegalTabId } from './components/LegalDocsModal';
import { MobileBottomNav } from './components/MobileBottomNav';
import { MovixAdSlot } from './components/MovixAdSlot';
import { OnboardingAuthFlow } from './components/OnboardingAuthFlow';
import { OfflineIndicator } from './components/PWAInstallButton';
import { UniversalNotificationFallback } from './components/UniversalNotificationFallback';
import { useAuth } from './contexts/AuthContext';
import { admApi } from './lib/admApi';
import { emitAdmDataSync, subscribeAdmDataSync } from './lib/admSync';
import { movixApi, type PublicConfigResponse } from './lib/api';
import {
  applyCloudConfigToSiteConfig,
  fetchCloudCatalogList,
  getCachedCloudSystemConfig,
  resolveCloudMediaUrl,
  subscribeCloudActiveAds,
  subscribeCloudSystemConfig,
  type CloudSystemPublicConfig,
} from './lib/firebase';
import { getStreamingPlatformBySlug } from './lib/providers';
import {
  getAppTourSteps,
  isAppTourDone,
  markAppTourDone,
  resetAllTours,
} from './lib/tour';
import { AdultPage } from './pages/AdultPage';
import { CatalogPage } from './pages/CatalogPage';
import { DetailPage } from './pages/DetailPage';
import { HomePage } from './pages/HomePage';
import { MyListPage } from './pages/MyListPage';
import { ProviderPage } from './pages/ProviderPage';
import { SectionPage } from './pages/SectionPage';
import type {
  AppRoute,
  MediaSummary,
  PlaybackRequest,
  StreamingPlatformSlug,
  ThematicSection,
} from './types/movix';

const MovixAdmApp = lazy(() => import('./adm/MovixAdmApp').then((m) => ({ default: m.MovixAdmApp })));
const MovixPlayer = lazy(() => import('./components/MovixPlayer').then((m) => ({ default: m.MovixPlayer })));
const SearchOverlay = lazy(() => import('./components/SearchOverlay').then((m) => ({ default: m.SearchOverlay })));

function PageLoader({ label = 'A carregar...' }: { label?: string }) {
  return (
    <div className="min-h-[55vh] flex items-center justify-center gap-3 text-sm text-[#A0A6B8]">
      <Loader2 className="h-5 w-5 animate-spin text-[#E5B85A]" />
      <span>{label}</span>
    </div>
  );
}

const THEMATIC_SECTIONS: ThematicSection[] = [
  'novelas',
  'doramas',
  'dramas',
  'animes',
  'infantil',
  'documentarios',
];

const STREAMING_SLUGS: StreamingPlatformSlug[] = [
  'netflix',
  'disney',
  'globoplay',
  'prime',
  'max',
  'apple',
  'crunchyroll',
  'paramount',
];

function parseDirectPlayIntent(): { season?: number; episode?: number } | null {
  try {
    const hashQuery = window.location.hash.includes('?')
      ? window.location.hash.slice(window.location.hash.indexOf('?'))
      : '';
    const params = new URLSearchParams(hashQuery || window.location.search);
    if (params.get('play') !== '1' && params.get('autoplay') !== '1') return null;
    const sRaw = Number(params.get('s'));
    const eRaw = Number(params.get('e'));
    return {
      season: Number.isInteger(sRaw) && sRaw > 0 ? sRaw : undefined,
      episode: Number.isInteger(eRaw) && eRaw > 0 ? eRaw : undefined,
    };
  } catch {
    return null;
  }
}

function parseHashRoute(): AppRoute {
  const hashRaw = window.location.hash.replace(/^#/, '').split('?')[0];
  const pathRaw = window.location.pathname;
  const raw = hashRaw || (pathRaw && pathRaw !== '/' ? pathRaw : '/');
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] === 'filmes') return { page: 'movies' };
  if (parts[0] === 'series') return { page: 'series' };
  if (parts[0] && THEMATIC_SECTIONS.includes(parts[0] as ThematicSection)) {
    return { page: 'section', section: parts[0] as ThematicSection };
  }
  if (parts[0] === 'streaming' && parts[1] && STREAMING_SLUGS.includes(parts[1] as StreamingPlatformSlug)) {
    return { page: 'provider', slug: parts[1] as StreamingPlatformSlug };
  }
  if (parts[0] === 'adulto') return { page: 'adult' };
  if ((parts[0] === 'filme' || parts[0] === 'movie') && parts[1] && /^\d+$/.test(parts[1])) {
    return { page: 'movie', id: Number(parts[1]) };
  }
  if ((parts[0] === 'serie' || parts[0] === 'tv') && parts[1] && /^\d+$/.test(parts[1])) {
    return { page: 'tv', id: Number(parts[1]) };
  }
  if (parts[0] === 'minha-lista') {
    const tab = parts[1] === 'offline' ? 'offline' : undefined;
    return { page: 'mylist', tab };
  }
  if (parts[0] === 'admin' || parts[0] === 'adm') {
    const sec = parts[1] || 'dashboard';
    return { page: 'admin', section: sec, tab: sec === 'notifications' ? 'notifications' : undefined };
  }
  return { page: 'home' };
}

function routeToHash(route: AppRoute): string {
  switch (route.page) {
    case 'movies':
      return '#/filmes';
    case 'series':
      return '#/series';
    case 'section':
      return `#/${route.section}`;
    case 'provider':
      return `#/streaming/${route.slug}`;
    case 'adult':
      return '#/adulto';
    case 'movie':
      return `#/filme/${route.id}`;
    case 'tv':
      return `#/serie/${route.id}`;
    case 'mylist':
      return route.tab === 'offline' ? '#/minha-lista/offline' : '#/minha-lista';
    case 'admin':
      return route.section && route.section !== 'dashboard' ? `#/adm/${route.section}` : '#/adm';
    default:
      return '#/';
  }
}

export default function App() {
  const {
    user,
    authReady,
    onboarding,
    language,
    t,
    allFavoriteKeys: favoriteKeys,
    toggleSyncedFavorite: handleToggleFavorite,
  } = useAuth();
  const [route, setRoute] = useState<AppRoute>(() => parseHashRoute());
  const [routeHistory, setRouteHistory] = useState<AppRoute[]>([]);
  const routeRef = useRef<AppRoute>(route);
  const playRequestIdRef = useRef<number>(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [footerLegalTab, setFooterLegalTab] = useState<LegalTabId | null>(null);
  const [publicConfig, setPublicConfig] = useState<PublicConfigResponse | null>(() =>
    movixApi.getCachedPublicConfig()
  );
  const [playerRequest, setPlayerRequest] = useState<PlaybackRequest | null>(null);
  const [deepLinkAutoPlay, setDeepLinkAutoPlay] = useState<{ season?: number; episode?: number } | null>(() =>
    parseDirectPlayIntent()
  );
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adultToken, setAdultToken] = useState<string | null>(null);
  const [appTourActive, setAppTourActive] = useState(false);

  const appTourSteps = useMemo(() => getAppTourSteps(language), [language]);

  const finishAppTour = useCallback(() => {
    markAppTourDone();
    setAppTourActive(false);
  }, []);

  const cloudConfigRef = useRef<CloudSystemPublicConfig | null>(getCachedCloudSystemConfig());
  const lastCloudSyncSigRef = useRef<string>('');
  const maintenanceLogoTapRef = useRef<{ count: number; lastTapAt: number }>({ count: 0, lastTapAt: 0 });

  const applySiteMeta = useCallback((siteCfg: PublicConfigResponse['siteConfig']) => {
    if (!siteCfg) return;
    if (siteCfg.faviconUrl) {
      const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
      if (link) link.href = siteCfg.faviconUrl;
    }
    if (siteCfg.seoDescription) {
      const metaDesc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (metaDesc) metaDesc.content = siteCfg.seoDescription;
    }
  }, []);

  const loadPublicConfig = useCallback(async (forceRefresh = false) => {
    try {
      const [cfg, cloudBanners, cloudHighlights, cloudCategories] = await Promise.all([
        forceRefresh ? movixApi.refreshPublicConfig() : movixApi.getPublicConfig(),
        fetchCloudCatalogList<PublicConfigResponse['banners'][number]>('banners').catch(() => null),
        fetchCloudCatalogList<PublicConfigResponse['highlights'][number]>('highlights').catch(() => null),
        fetchCloudCatalogList<PublicConfigResponse['categories'][number]>('categories').catch(() => null),
      ]);
      const cloud = cloudConfigRef.current || getCachedCloudSystemConfig();
      const baseSiteConfig = cloud
        ? applyCloudConfigToSiteConfig(cfg.siteConfig, cloud)
        : cfg.siteConfig;

      // Resolve any cloud-backed uploaded media URLs (?cm=...) transparently so images never 404 after updates
      const [resolvedLogo, resolvedFavicon] = await Promise.all([
        baseSiteConfig?.logoUrl?.includes('cm=')
          ? resolveCloudMediaUrl(baseSiteConfig.logoUrl)
          : Promise.resolve(baseSiteConfig?.logoUrl || ''),
        baseSiteConfig?.faviconUrl?.includes('cm=')
          ? resolveCloudMediaUrl(baseSiteConfig.faviconUrl)
          : Promise.resolve(baseSiteConfig?.faviconUrl || ''),
      ]);

      const rawBanners =
        cloudBanners && cloudBanners.length > 0 ? cloudBanners : cfg.banners;
      const rawHighlights =
        cloudHighlights && cloudHighlights.length > 0 ? cloudHighlights : cfg.highlights;
      const rawCategories =
        cloudCategories && cloudCategories.length > 0 ? cloudCategories : cfg.categories;

      const [resolvedBanners, resolvedHighlights, resolvedCategories] = await Promise.all([
        Promise.all(
          rawBanners.map(async (b) => ({
            ...b,
            backdropUrl: b.backdropUrl?.includes('cm=')
              ? await resolveCloudMediaUrl(b.backdropUrl)
              : b.backdropUrl,
            posterUrl: b.posterUrl?.includes('cm=')
              ? await resolveCloudMediaUrl(b.posterUrl)
              : b.posterUrl,
          }))
        ),
        Promise.all(
          rawHighlights.map(async (h) => ({
            ...h,
            backdropUrl: h.backdropUrl?.includes('cm=')
              ? await resolveCloudMediaUrl(h.backdropUrl)
              : h.backdropUrl,
            posterUrl: h.posterUrl?.includes('cm=')
              ? await resolveCloudMediaUrl(h.posterUrl)
              : h.posterUrl,
          }))
        ),
        Promise.all(
          rawCategories.map(async (c) => ({
            ...c,
            imageUrl: c.imageUrl?.includes('cm=')
              ? await resolveCloudMediaUrl(c.imageUrl)
              : c.imageUrl,
          }))
        ),
      ]);

      const mergedCfg: PublicConfigResponse = {
        ...cfg,
        banners: resolvedBanners,
        highlights: resolvedHighlights,
        categories: resolvedCategories,
        siteConfig: baseSiteConfig
          ? {
              ...baseSiteConfig,
              logoUrl: resolvedLogo,
              faviconUrl: resolvedFavicon,
            }
          : baseSiteConfig,
      };
      setPublicConfig(mergedCfg);
      applySiteMeta(mergedCfg.siteConfig);
    } catch {
      // ignore initial config error
    }
  }, [applySiteMeta]);

  useEffect(() => {
    void loadPublicConfig(false);
    return subscribeAdmDataSync(() => {
      void loadPublicConfig(true);
    });
  }, [loadPublicConfig]);

  // Real-time Cloud Firestore synchronization across Preview, Published PWA, and all devices
  useEffect(() => {
    const unsubConfig = subscribeCloudSystemConfig((cloudCfg) => {
      if (!cloudCfg) return;
      cloudConfigRef.current = cloudCfg;
      void (async () => {
        const [resolvedLogo, resolvedFavicon] = await Promise.all([
          cloudCfg.logoUrl?.includes('cm=')
            ? resolveCloudMediaUrl(cloudCfg.logoUrl)
            : Promise.resolve(cloudCfg.logoUrl),
          cloudCfg.faviconUrl?.includes('cm=')
            ? resolveCloudMediaUrl(cloudCfg.faviconUrl)
            : Promise.resolve(cloudCfg.faviconUrl),
        ]);
        const hydratedCloud = {
          ...cloudCfg,
          logoUrl: resolvedLogo,
          faviconUrl: resolvedFavicon,
        };
        setPublicConfig((prev) => {
          const nextSiteConfig = applyCloudConfigToSiteConfig(prev?.siteConfig, hydratedCloud);
          applySiteMeta(nextSiteConfig);
          if (prev) {
            return { ...prev, siteConfig: nextSiteConfig };
          }
          return {
            categories: [],
            banners: [],
            highlights: [],
            megambdConfigured: false,
            tmdbConfigured: false,
            adultPinConfigured: false,
            siteConfig: nextSiteConfig,
          };
        });
      })();
      const sig = JSON.stringify({
        m: cloudCfg.maintenanceMode,
        a: cloudCfg.adsGlobalEnabled,
        d: cloudCfg.dismissCooldownMinutes,
        l: cloudCfg.largeAdIntervalMinutes,
        p: cloudCfg.playerAdIntervalMinutes,
        h: cloudCfg.headerAdAlwaysVisible,
        u: cloudCfg.updatedAt,
      });
      if (sig !== lastCloudSyncSigRef.current) {
        const hadPrev = lastCloudSyncSigRef.current !== '';
        lastCloudSyncSigRef.current = sig;
        if (hadPrev) {
          emitAdmDataSync();
        }
      }
    });

    let hasInitialAdsSnapshot = false;
    let lastAdsSig = '';
    const unsubAds = subscribeCloudActiveAds((cloudAds) => {
      const sig = cloudAds.map((a) => `${a.id}:${a.status}:${a.updatedAt}`).sort().join('|');
      if (!hasInitialAdsSnapshot) {
        hasInitialAdsSnapshot = true;
        lastAdsSig = sig;
        return;
      }
      if (sig !== lastAdsSig) {
        lastAdsSig = sig;
        emitAdmDataSync();
      }
    });

    return () => {
      unsubConfig();
      unsubAds();
    };
  }, [applySiteMeta]);

  const isVerifiedOwner =
    user?.authSource === 'firebase' &&
    Boolean(user?.email) &&
    user!.email!.trim().toLowerCase() === 'gelitontn1@gmail.com' &&
    Boolean(user?.emailVerified);

  useEffect(() => {
    // Ensure catalog sections reload in the active language
    void movixApi.getHomeCatalog().then(() => movixApi.prefetchBrowseCatalogs()).catch(() => {});
  }, [language]);

  useEffect(() => {
    const onRouteLocationChange = () => {
      const parsed = parseHashRoute();
      const playIntent = parseDirectPlayIntent();
      if (playIntent) setDeepLinkAutoPlay(playIntent);
      if (routeToHash(parsed) !== routeToHash(routeRef.current)) {
        setRouteHistory((prev) => [...prev.slice(-29), routeRef.current]);
        routeRef.current = parsed;
        setRoute(parsed);
      }
    };
    window.addEventListener('hashchange', onRouteLocationChange);
    window.addEventListener('popstate', onRouteLocationChange);
    return () => {
      window.removeEventListener('hashchange', onRouteLocationChange);
      window.removeEventListener('popstate', onRouteLocationChange);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    switch (route.page) {
      case 'home':
        document.title = 'MOVIX';
        break;
      case 'movies':
        document.title = `${t.movies} · MOVIX`;
        break;
      case 'series':
        document.title = `${t.series} · MOVIX`;
        break;
      case 'section': {
        const labels: Record<ThematicSection, string> = {
          novelas: t.novelas,
          doramas: t.doramas,
          dramas: t.dramas,
          animes: t.animes,
          infantil: t.kids,
          documentarios: t.documentaries,
        };
        document.title = `${labels[route.section]} · MOVIX`;
        break;
      }
      case 'provider': {
        const plat = getStreamingPlatformBySlug(route.slug);
        document.title = `${plat.name} · MOVIX`;
        break;
      }
      case 'adult':
        document.title = '+18 · MOVIX';
        break;
      case 'mylist':
        document.title = `${t.myList} · MOVIX`;
        break;
      case 'admin':
        document.title = 'Admin · MOVIX';
        break;
      default:
        break;
    }
  }, [route, t]);

  const navigate = useCallback((next: AppRoute) => {
    const current = routeRef.current;
    const nextHash = routeToHash(next);
    if (nextHash !== routeToHash(current)) {
      setRouteHistory((prev) => [...prev.slice(-29), current]);
    }
    routeRef.current = next;
    setRoute(next);
    if (window.location.pathname !== '/' && window.history?.replaceState) {
      window.history.replaceState(null, '', `/${nextHash}`);
    } else if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleGoBack = useCallback(() => {
    if (routeHistory.length > 0) {
      const prevRoute = routeHistory[routeHistory.length - 1];
      setRouteHistory((prev) => prev.slice(0, -1));
      routeRef.current = prevRoute;
      setRoute(prevRoute);
      const prevHash = routeToHash(prevRoute);
      if (window.location.hash !== prevHash) {
        window.location.hash = prevHash;
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const homeRoute: AppRoute = { page: 'home' };
    routeRef.current = homeRoute;
    setRoute(homeRoute);
    if (window.location.hash !== '#/') {
      window.location.hash = '#/';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [routeHistory]);

  const handleOpenAccount = useCallback(() => {
    if (user) {
      setAccountModalOpen(true);
    } else {
      setAuthModalOpen(true);
    }
  }, [user]);

  const handleOpenOwnerAdminPanel = useCallback(() => {
    if (
      !user ||
      user.authSource !== 'firebase' ||
      !user.emailVerified ||
      user.email?.trim().toLowerCase() !== 'gelitontn1@gmail.com'
    ) {
      return;
    }
    setAdminToken(null);
    setAccountModalOpen(false);
    navigate({ page: 'admin', section: 'dashboard' });
  }, [user, navigate]);

  // Secret 5-tap shortcut ONLY on the MOVIX logo inside the Maintenance screen -> redirects to ADM login
  const handleMaintenanceLogoTap = useCallback(() => {
    const now = Date.now();
    const prev = maintenanceLogoTapRef.current;
    const nextCount = now - prev.lastTapAt <= 2500 ? prev.count + 1 : 1;
    if (nextCount >= 5) {
      maintenanceLogoTapRef.current = { count: 0, lastTapAt: 0 };
      setAdminToken(null);
      navigate({ page: 'admin', section: 'dashboard' });
      return;
    }
    maintenanceLogoTapRef.current = { count: nextCount, lastTapAt: now };
  }, [navigate]);

  const handleNavigatePushTarget = useCallback(
    (targetUrl: string) => {
      const trimmed = (targetUrl || '').trim();
      if (!trimmed) return;
      if (trimmed.startsWith('#/')) {
        window.location.hash = trimmed;
        return;
      }
      if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
        window.location.hash = `#${trimmed}`;
        return;
      }
      try {
        const parsed = new URL(trimmed, window.location.origin);
        if (parsed.origin === window.location.origin) {
          if (parsed.hash.startsWith('#/')) {
            window.location.hash = parsed.hash;
          } else {
            window.location.hash = `#${parsed.pathname}`;
          }
        } else if (parsed.protocol === 'https:') {
          window.location.assign(parsed.toString());
        }
      } catch {
        // Ignore invalid target URL
      }
    },
    []
  );

  useEffect(() => {
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'MOVIX_PUSH_NAVIGATE' && typeof event.data.targetUrl === 'string') {
        handleNavigatePushTarget(event.data.targetUrl);
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleSwMessage);
    };
  }, [handleNavigatePushTarget]);

  const handleQuickPlay = useCallback(async (item: MediaSummary) => {
    const reqId = ++playRequestIdRef.current;
    admApi.trackView({
      mediaType: item.mediaType,
      id: item.id,
      title: item.title,
      posterUrl: item.posterUrl,
      uid: user?.uid || null,
    });
    setPlayerRequest({
      mediaType: item.mediaType,
      tmdbId: item.id,
      title: item.title,
      posterUrl: item.posterUrl,
      backdropUrl: item.backdropUrl,
      loadingSource: true,
    });

    try {
      const detailsPromise =
        item.id > 0
          ? item.mediaType === 'movie'
            ? movixApi.getMovieDetails(item.id).catch(() => null)
            : movixApi.getSeriesDetails(item.id).catch(() => null)
          : Promise.resolve(null);

      const firstSeasonPromise =
        item.id > 0 && item.mediaType === 'tv'
          ? movixApi.getSeriesSeason(item.id, 1).catch(() => null)
          : Promise.resolve(null);

      const matchPromise = movixApi.matchMegambd({
        mediaType: item.mediaType,
        title: item.title,
        originalTitle: item.originalTitle,
        tmdbId: item.id,
        season: item.mediaType === 'tv' ? 1 : undefined,
        episode: item.mediaType === 'tv' ? 1 : undefined,
      });

      const [det, firstSeason, match] = await Promise.all([
        detailsPromise,
        firstSeasonPromise,
        matchPromise,
      ]);
      if (playRequestIdRef.current !== reqId) return;

      const trailerKey = det?.trailers?.[0]?.key || null;

      let streamUrl: string | null = null;
      let embedUrl: string | null = match.matched ? match.embedUrl || null : null;
      let embedMirrors = match.matched ? match.embedMirrors : undefined;
      let seasonNum: number | undefined;
      let epNum: number | undefined;
      let episodeTitle: string | undefined;
      let nextEpisode: PlaybackRequest['nextEpisode'] = null;

      if (item.mediaType === 'movie') {
        streamUrl = match.matched ? match.streamUrl || null : null;
      } else if (match.matched && match.seriesInfo?.episodes) {
        const episodesMap = match.seriesInfo.episodes;
        const seasonKeys = Object.keys(episodesMap).sort((a, b) => Number(a) - Number(b));
        const firstSeasonKey = episodesMap['1']?.length ? '1' : seasonKeys[0];
        const seasonEps = firstSeasonKey ? episodesMap[firstSeasonKey] || [] : [];
        const ep = seasonEps[0];
        const secondEp = seasonEps[1];
        if (ep) {
          const ext = (ep.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
          streamUrl = `/api/stream/series/${ep.id}?ext=${encodeURIComponent(ext)}`;
          seasonNum = Number(firstSeasonKey || 1);
          epNum = Number(ep.episode_num || 1);
          episodeTitle = ep.title || undefined;
          if (secondEp) {
            const nextExt =
              (secondEp.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
            nextEpisode = {
              seasonNumber: seasonNum,
              episodeNumber: Number(secondEp.episode_num || 2),
              episodeTitle: secondEp.title || `Episódio ${secondEp.episode_num || 2}`,
              megambdStreamUrl: `/api/stream/series/${secondEp.id}?ext=${encodeURIComponent(nextExt)}`,
            };
          }
        }
      } else if (item.mediaType === 'tv') {
        streamUrl = match.matched ? match.streamUrl || null : null;
        seasonNum = 1;
        epNum = 1;
        const firstEp = firstSeason?.episodes?.[0];
        const secondEp = firstSeason?.episodes?.[1];
        episodeTitle = firstEp?.name || 'Episódio 1';
        if (secondEp) {
          nextEpisode = {
            seasonNumber: secondEp.seasonNumber,
            episodeNumber: secondEp.episodeNumber,
            episodeTitle: secondEp.name,
            megambdStreamUrl: null,
          };
        }
      }

      const hasPlayableSource = Boolean(streamUrl || embedUrl);

      setPlayerRequest({
        mediaType: item.mediaType,
        tmdbId: item.id,
        title: item.title,
        posterUrl: item.posterUrl,
        backdropUrl: item.backdropUrl,
        seasonNumber: seasonNum,
        episodeNumber: epNum,
        episodeTitle,
        megambdStreamUrl: streamUrl,
        embedUrl,
        embedMirrors,
        megambdError: hasPlayableSource ? null : match.message || null,
        trailerKey,
        nextEpisode,
        loadingSource: false,
      });
    } catch (err) {
      if (playRequestIdRef.current !== reqId) return;
      setPlayerRequest({
        mediaType: item.mediaType,
        tmdbId: item.id,
        title: item.title,
        posterUrl: item.posterUrl,
        backdropUrl: item.backdropUrl,
        megambdStreamUrl: null,
        megambdError: err instanceof Error ? err.message : 'Erro ao iniciar reprodução.',
        loadingSource: false,
      });
    }
  }, [user?.uid]);

  const handlePlayNextEpisode = useCallback(async () => {
    if (!playerRequest?.nextEpisode || playerRequest.mediaType !== 'tv') return;
    const next = playerRequest.nextEpisode;
    try {
      const [season, matchRes] = await Promise.all([
        movixApi.getSeriesSeason(playerRequest.tmdbId, next.seasonNumber).catch(() => null),
        !next.megambdStreamUrl && !next.embedUrl
          ? movixApi
              .matchMegambd({
                mediaType: 'tv',
                title: playerRequest.title,
                tmdbId: playerRequest.tmdbId,
                season: next.seasonNumber,
                episode: next.episodeNumber,
              })
              .catch(() => null)
          : Promise.resolve(null),
      ]);

      const nextAfter = season?.episodes.find((e) => e.episodeNumber === next.episodeNumber + 1) || null;
      const streamUrl = next.megambdStreamUrl || matchRes?.streamUrl || null;
      const embedUrl = next.embedUrl || matchRes?.embedUrl || null;
      const embedMirrors = next.embedMirrors || matchRes?.embedMirrors;

      setPlayerRequest({
        ...playerRequest,
        seasonNumber: next.seasonNumber,
        episodeNumber: next.episodeNumber,
        episodeTitle: next.episodeTitle,
        megambdStreamUrl: streamUrl,
        embedUrl,
        embedMirrors,
        megambdError: streamUrl || embedUrl ? null : 'Próximo episódio indisponível no MegamBD.',
        nextEpisode: nextAfter
          ? {
              seasonNumber: nextAfter.seasonNumber,
              episodeNumber: nextAfter.episodeNumber,
              episodeTitle: nextAfter.name,
              megambdStreamUrl: null,
            }
          : null,
      });
    } catch {
      setPlayerRequest({
        ...playerRequest,
        seasonNumber: next.seasonNumber,
        episodeNumber: next.episodeNumber,
        episodeTitle: next.episodeTitle,
        megambdStreamUrl: next.megambdStreamUrl || null,
        embedUrl: next.embedUrl || null,
        embedMirrors: next.embedMirrors,
      });
    }
  }, [playerRequest]);

  const handleSelectPlayerEpisode = useCallback(
    async (seasonNumber: number, episodeNumber: number, episodeTitle: string) => {
      if (!playerRequest || playerRequest.mediaType !== 'tv') return;
      try {
        const [season, matchRes] = await Promise.all([
          movixApi.getSeriesSeason(playerRequest.tmdbId, seasonNumber).catch(() => null),
          movixApi
            .matchMegambd({
              mediaType: 'tv',
              title: playerRequest.title,
              tmdbId: playerRequest.tmdbId,
              season: seasonNumber,
              episode: episodeNumber,
            })
            .catch(() => null),
        ]);
        const nextAfter =
          season?.episodes.find((e) => e.episodeNumber === episodeNumber + 1) || null;
        setPlayerRequest({
          ...playerRequest,
          seasonNumber,
          episodeNumber,
          episodeTitle,
          megambdStreamUrl: matchRes?.streamUrl || null,
          embedUrl: matchRes?.embedUrl || null,
          embedMirrors: matchRes?.embedMirrors,
          megambdError:
            matchRes?.streamUrl || matchRes?.embedUrl
              ? null
              : 'Episódio indisponível no MegamBD.',
          nextEpisode: nextAfter
            ? {
                seasonNumber: nextAfter.seasonNumber,
                episodeNumber: nextAfter.episodeNumber,
                episodeTitle: nextAfter.name,
                megambdStreamUrl: null,
              }
            : null,
        });
      } catch {
        // Ignore transient switching errors
      }
    },
    [playerRequest]
  );

  const showCategoryRibbon =
    route.page === 'home' ||
    route.page === 'movies' ||
    route.page === 'series' ||
    route.page === 'section' ||
    route.page === 'provider' ||
    route.page === 'adult';

  const isDirectSharedTitle = route.page === 'movie' || route.page === 'tv';
  const showNewUserOnboarding =
    !user &&
    (!onboarding.onboardingCompleted || !onboarding.termsAccepted) &&
    route.page !== 'admin' &&
    !isDirectSharedTitle;

  useEffect(() => {
    if (
      showNewUserOnboarding ||
      !authReady ||
      playerRequest ||
      searchOpen ||
      authModalOpen ||
      accountModalOpen ||
      route.page === 'admin' ||
      isAppTourDone()
    ) {
      return;
    }
    const timer = setTimeout(() => {
      if (!isAppTourDone()) {
        setAppTourActive(true);
      }
    }, 1150);
    return () => clearTimeout(timer);
  }, [
    showNewUserOnboarding,
    authReady,
    playerRequest,
    searchOpen,
    authModalOpen,
    accountModalOpen,
    route.page,
  ]);

  const handleReplayTutorial = useCallback(() => {
    resetAllTours();
    if (routeRef.current.page !== 'home') {
      navigate({ page: 'home' });
      setTimeout(() => setAppTourActive(true), 420);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => setAppTourActive(true), 220);
    }
  }, [navigate]);

  const handleAdmPublicDataChanged = useCallback(() => {
    emitAdmDataSync();
    void loadPublicConfig(true);
  }, [loadPublicConfig]);

  const handleAdmOpenPublicSite = useCallback(() => {
    setAdminToken(null);
    void loadPublicConfig(true);
    if (window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/#/');
    }
    navigate({ page: 'home' });
  }, [loadPublicConfig, navigate]);

  // STANDALONE MOVIX ADM — Synchronized live with MOVIX & accessible secretly from owner profile
  if (route.page === 'admin') {
    return (
      <Suspense fallback={<PageLoader label="A iniciar MOVIX ADM..." />}>
        <MovixAdmApp
          initialSection={route.section || (route.tab === 'notifications' ? 'notifications' : 'dashboard')}
          adminToken={adminToken}
          onSetAdminToken={setAdminToken}
          onPublicDataChanged={handleAdmPublicDataChanged}
          onOpenPublicSite={handleAdmOpenPublicSite}
        />
      </Suspense>
    );
  }

  // Maintenance mode controlled live from MOVIX ADM -> Configurações
  if (publicConfig?.siteConfig?.maintenanceMode) {
    return (
      <>
        <UniversalNotificationFallback />
        <div className="min-h-screen bg-[#06070B] text-white flex flex-col items-center justify-center p-6 text-center space-y-5">
          <div
            onClick={handleMaintenanceLogoTap}
            className="select-none cursor-default"
          >
            <BrandMark size="md" />
          </div>
          <div className="max-w-md space-y-2">
            <h1 className="text-2xl font-bold text-white">Estamos em Manutenção</h1>
            <p className="text-sm text-[#95A0B8] leading-relaxed">
              O {publicConfig.siteConfig.platformName || 'MOVIX'} está a receber melhorias. Voltaremos em breve!
            </p>
          </div>
        </div>
      </>
    );
  }

  if (showNewUserOnboarding) {
    return (
      <>
        <UniversalNotificationFallback />
        <OnboardingAuthFlow
          mode="onboarding"
          onFinished={() => {
            setAuthModalOpen(false);
            if (routeRef.current.page !== 'home') {
              navigate({ page: 'home' });
            }
          }}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#06070B] text-[#F6F7FB]">
      <Header
        route={route}
        onNavigate={navigate}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenAccount={handleOpenAccount}
      />
      {showCategoryRibbon && (
        <CategoryRibbon route={route} onNavigate={navigate} adultUnlocked={Boolean(adultToken)} />
      )}

      {/* MOVIX ADS — Header placement (renders nothing if no active ad) */}
      <div className="max-w-[1400px] w-full mx-auto px-3 sm:px-6 lg:px-8 empty:hidden pt-2">
        <MovixAdSlot placement="header" />
      </div>

      <main key={language} className="flex-1 pb-20 md:pb-0">
        {route.page === 'home' && (
          <HomePage
            publicConfig={publicConfig}
            onNavigate={navigate}
            onQuickPlay={handleQuickPlay}
            favoriteKeys={favoriteKeys}
            onToggleFavorite={handleToggleFavorite}
          />
        )}

        {route.page === 'movies' && (
          <CatalogPage
            mode="movie"
            publicConfig={publicConfig}
            onNavigate={navigate}
            onGoBack={handleGoBack}
            onPlay={handleQuickPlay}
            favoriteKeys={favoriteKeys}
            onToggleFavorite={handleToggleFavorite}
          />
        )}

        {route.page === 'series' && (
          <CatalogPage
            mode="tv"
            publicConfig={publicConfig}
            onNavigate={navigate}
            onGoBack={handleGoBack}
            onPlay={handleQuickPlay}
            favoriteKeys={favoriteKeys}
            onToggleFavorite={handleToggleFavorite}
          />
        )}

        {route.page === 'section' && (
          <SectionPage
            section={route.section}
            onNavigate={navigate}
            onGoBack={handleGoBack}
            onPlay={handleQuickPlay}
            favoriteKeys={favoriteKeys}
            onToggleFavorite={handleToggleFavorite}
          />
        )}

        {route.page === 'provider' && (
          <ProviderPage
            slug={route.slug}
            onNavigate={navigate}
            onGoBack={handleGoBack}
            onPlay={handleQuickPlay}
            favoriteKeys={favoriteKeys}
            onToggleFavorite={handleToggleFavorite}
          />
        )}

        {route.page === 'adult' && (
          <AdultPage
            adultToken={adultToken}
            onSetAdultToken={setAdultToken}
            onNavigate={navigate}
            onGoBack={handleGoBack}
            onPlay={handleQuickPlay}
            favoriteKeys={favoriteKeys}
            onToggleFavorite={handleToggleFavorite}
          />
        )}

        {(route.page === 'movie' || route.page === 'tv') && (
          <DetailPage
            mediaType={route.page}
            id={route.id}
            autoPlay={deepLinkAutoPlay}
            onAutoPlayConsumed={() => setDeepLinkAutoPlay(null)}
            onNavigate={navigate}
            onGoBack={handleGoBack}
            onPlay={(req) => {
              playRequestIdRef.current++;
              admApi.trackView({
                mediaType: req.mediaType,
                id: req.tmdbId,
                title: req.title,
                posterUrl: req.posterUrl,
                uid: user?.uid || null,
              });
              setPlayerRequest(req);
            }}
            onQuickPlay={handleQuickPlay}
            favoriteKeys={favoriteKeys}
            onToggleFavorite={handleToggleFavorite}
          />
        )}

        {route.page === 'mylist' && (
          <MyListPage
            initialTab={route.tab}
            onNavigate={navigate}
            onGoBack={handleGoBack}
            onPlay={handleQuickPlay}
            onToggleFavorite={handleToggleFavorite}
          />
        )}
      </main>

      {/* MOVIX ADS — Footer placement (renders nothing if no active ad) */}
      <div className="max-w-[1400px] w-full mx-auto px-3 sm:px-6 lg:px-8 empty:hidden pb-4">
        <MovixAdSlot placement="footer" />
      </div>

      {!showCategoryRibbon && (
        <footer className="border-t border-white/[0.06] bg-[#07090F] mb-16 md:mb-0">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <BrandMark size="sm" />
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-[#8D97AF]">
              <button type="button" onClick={() => setFooterLegalTab('termos')} className="hover:text-[#F3C669] transition-colors cursor-pointer">
                {t.termsOfUse}
              </button>
              <button type="button" onClick={() => setFooterLegalTab('privacidade')} className="hover:text-[#F3C669] transition-colors cursor-pointer">
                {t.privacyPolicy}
              </button>
              <button type="button" onClick={() => setFooterLegalTab('dmca')} className="hover:text-[#F3C669] transition-colors cursor-pointer">
                {t.legalNotice}
              </button>
            </div>
            <p className="text-xs text-[#6E778E]">
              © {new Date().getFullYear()} {publicConfig?.siteConfig?.platformName || 'MOVIX'}
            </p>
          </div>
        </footer>
      )}

      <MobileBottomNav route={route} onNavigate={navigate} />
      <OfflineIndicator onOpenOffline={() => navigate({ page: 'mylist', tab: 'offline' })} />

      {authModalOpen && (
        <OnboardingAuthFlow
          mode="auth"
          onFinished={() => setAuthModalOpen(false)}
          onClose={() => setAuthModalOpen(false)}
        />
      )}

      <AccountModal
        open={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        onReplayTutorial={handleReplayTutorial}
        onOpenAdminPanel={isVerifiedOwner ? handleOpenOwnerAdminPanel : undefined}
      />

      <GuidedSpotlightTour
        active={
          appTourActive &&
          !playerRequest &&
          !searchOpen &&
          !authModalOpen &&
          !accountModalOpen &&
          footerLegalTab === null
        }
        steps={appTourSteps}
        onComplete={finishAppTour}
        onSkipAll={finishAppTour}
      />

      <LegalDocsModal
        open={footerLegalTab !== null}
        initialTab={footerLegalTab || 'termos'}
        onClose={() => setFooterLegalTab(null)}
      />

      {searchOpen && (
        <Suspense fallback={null}>
          <SearchOverlay
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            onSelectMedia={(item) => navigate({ page: item.mediaType === 'tv' ? 'tv' : 'movie', id: item.id })}
          />
        </Suspense>
      )}

      {playerRequest && (
        <Suspense fallback={<PageLoader label={t.loading} />}>
          <MovixPlayer
            request={playerRequest}
            onClose={() => {
              playRequestIdRef.current++;
              setPlayerRequest(null);
            }}
            onPlayNextEpisode={playerRequest.nextEpisode ? () => void handlePlayNextEpisode() : undefined}
            favoriteKeys={favoriteKeys}
            onToggleFavorite={handleToggleFavorite}
            onSelectMedia={(item) => void handleQuickPlay(item)}
            onSelectEpisode={(s, e, t) => void handleSelectPlayerEpisode(s, e, t)}
          />
        </Suspense>
      )}
      <UniversalNotificationFallback />
    </div>
  );
}
