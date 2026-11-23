import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createAdmRouter } from './server/admRoutes.ts';
import { getAdmStore, refreshAdStatuses } from './server/admStore.ts';
import {
  getAdminAuthStatus,
  getAdultAuthStatus,
  loginAdmin,
  loginAdminWithFirebaseIdToken,
  requireAdmin,
  requireAdultUnlocked,
  setupAdultPin,
  setupInitialAdmin,
  unlockAdultContent,
  updateOwnAdminPassword,
} from './server/auth.ts';
import { getPublicConfigStatus, updateRuntimeConfig } from './server/config.ts';
import {
  getMegambdCategories,
  getMegambdSeriesInfo,
  getMegambdSeriesList,
  getMegambdStatus,
  getMegambdVodInfo,
  getMegambdVodStreams,
  matchMegambdContent,
} from './server/megambd.ts';
import {
  broadcastConfigSyncEvent,
  dispatchWelcomePushIfNeeded,
  getPushOverviewStats,
  getRecentBroadcastsSince,
  registerPushSseClient,
  sanitizePushCategory,
  sendOrScheduleAdminCampaign,
  startPushScheduler,
} from './server/push.ts';
import {
  clearCache,
  clearErrorLogs,
  deleteScheduledPushCampaign,
  getCacheStats,
  getPushSubscriptionByToken,
  getStore,
  setBanners,
  setCategories,
  setHighlights,
  updatePushSubscriptionPrefs,
  upsertPushSubscription,
  type BannerItem,
  type HighlightItem,
  type ManagedCategory,
  type PushPrefs,
} from './server/store.ts';
import { handleMediaStreamProxy } from './server/stream.ts';
import {
  getAdultCatalog,
  getAllGenres,
  getHomeCatalog,
  getMovieDetails,
  getMoviesCatalog,
  getSectionCatalog,
  getSeriesCatalog,
  runWithTmdbLanguage,
  getSeriesDetails,
  getSeriesSeason,
  getStreamingProviderCatalog,
  searchTmdb,
  testTmdbAuth,
  type ThematicSection,
} from './server/tmdb.ts';
import {
  handlePublicUserLogin,
  handlePublicUserLogout,
  handlePublicUserMe,
  handlePublicUserRegister,
  handlePublicUserToggleFavorite,
  handlePublicUserUpdatePrefs,
  requirePublicUser,
} from './server/userAuth.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

async function createAppServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  // Basic security headers (iframe compatible in AI Studio)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Mount MOVIX ADM & MOVIX ADS API router (includes binary upload endpoint)
  app.use(createAdmRouter());

  const SERVER_BOOT_VERSION = `srv-${Date.now().toString(36)}`;

  // Health & public non-secret configuration
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'MOVIX', timestamp: new Date().toISOString() });
  });

  // ================= PUBLIC USER EMAIL/PASSWORD AUTH ROUTES =================
  app.post('/api/auth/register', handlePublicUserRegister);
  app.post('/api/auth/login', handlePublicUserLogin);
  app.get('/api/auth/me', handlePublicUserMe);
  app.post('/api/auth/logout', handlePublicUserLogout);
  app.put('/api/auth/preferences', requirePublicUser, handlePublicUserUpdatePrefs);
  app.put('/api/auth/favorites', requirePublicUser, handlePublicUserToggleFavorite);

  app.get('/api/version', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    try {
      const versionFile = path.resolve(process.cwd(), 'dist', 'version.json');
      if (fs.existsSync(versionFile)) {
        const parsed = JSON.parse(fs.readFileSync(versionFile, 'utf-8')) as {
          version?: string;
          builtAt?: string;
        };
        if (parsed.version) {
          res.json({ version: parsed.version, builtAt: parsed.builtAt || new Date().toISOString() });
          return;
        }
      }
    } catch {
      // Fallback to runtime server boot version
    }
    res.json({ version: SERVER_BOOT_VERSION, builtAt: new Date().toISOString() });
  });

  app.get('/api/config/public', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    refreshAdStatuses();
    const store = getStore();
    const admStore = getAdmStore();
    const status = getPublicConfigStatus();
    res.json({
      tmdbConfigured: status.tmdbConfigured,
      megambdConfigured: status.megambdConfigured,
      banners: store.banners.filter((b) => b.active).sort((a, b) => a.order - b.order),
      highlights: store.highlights.filter((h) => h.active).sort((a, b) => a.order - b.order),
      categories: store.categories.filter((c) => c.visible).sort((a, b) => a.order - b.order),
      siteConfig: admStore.siteConfig,
      adsGlobalEnabled: admStore.siteConfig.adsGlobalEnabled,
      genres: admStore.genres.filter((g) => g.active).sort((a, b) => a.order - b.order),
      servers: admStore.servers.filter((s) => s.active).sort((a, b) => a.order - b.order),
      managedMovies: admStore.movies
        .filter((m) => m.published)
        .slice(0, 40)
        .map((m) => ({
          id: m.id,
          tmdbId: m.tmdbId,
          title: m.title,
          originalTitle: m.originalTitle,
          overview: m.overview,
          posterUrl: m.posterUrl,
          backdropUrl: m.backdropUrl,
          year: m.year,
          releaseDate: m.releaseDate,
          rating: m.rating,
          featured: m.featured,
          recommended: m.recommended,
          genres: m.genres,
          categories: m.categories,
        })),
      managedSeries: admStore.series
        .filter((s) => s.published)
        .slice(0, 40)
        .map((s) => ({
          id: s.id,
          tmdbId: s.tmdbId,
          title: s.title,
          originalTitle: s.originalTitle,
          overview: s.overview,
          posterUrl: s.posterUrl,
          backdropUrl: s.backdropUrl,
          year: s.year,
          releaseDate: s.releaseDate,
          rating: s.rating,
          featured: s.featured,
          recommended: s.recommended,
          genres: s.genres,
          categories: s.categories,
          seasonsCount: s.seasons.filter((sea) => sea.published).length,
        })),
    });
  });

  // ================= GEOLOCATION AUTO-LANGUAGE ROUTE =================
  const geoCache = new Map<
    string,
    { countryCode: string; countryName: string; regionLanguage: string; expiresAt: number }
  >();

  function mapCountryToMovixLanguage(countryCode: string): string {
    const cc = countryCode.trim().toUpperCase();
    if (cc === 'BR') return 'pt-BR';
    if (['PT', 'AO', 'MZ', 'CV', 'GW', 'ST', 'TL'].includes(cc)) return 'pt-PT';
    if (cc === 'ES') return 'es-ES';
    if (
      [
        'MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'GT', 'CU', 'BO',
        'DO', 'HN', 'PY', 'SV', 'NI', 'CR', 'PA', 'UY', 'PR', 'GQ',
      ].includes(cc)
    ) {
      return 'es-419';
    }
    if (
      ['FR', 'MC', 'LU', 'SN', 'CI', 'CM', 'ML', 'BF', 'NE', 'CD', 'CG', 'GA', 'HT', 'RE', 'GP', 'MQ'].includes(cc)
    ) {
      return 'fr';
    }
    if (['IT', 'SM', 'VA'].includes(cc)) return 'it';
    return 'en';
  }

  function mapAcceptLanguageToMovix(headerVal: string): string | null {
    const raw = (headerVal || '').toLowerCase();
    if (!raw) return null;
    const primary = raw.split(',')[0]?.split(';')[0]?.trim() || '';
    if (primary.startsWith('pt-br')) return 'pt-BR';
    if (primary.startsWith('pt')) return 'pt-PT';
    if (primary.startsWith('es-es')) return 'es-ES';
    if (primary.startsWith('es')) return 'es-419';
    if (primary.startsWith('fr')) return 'fr';
    if (primary.startsWith('it')) return 'it';
    if (primary.startsWith('en')) return 'en';
    return null;
  }

  function isPublicClientIp(ip: string): boolean {
    const clean = ip.replace(/^::ffff:/, '').trim();
    if (!clean || clean === '::1' || clean === '127.0.0.1' || clean === 'localhost') return false;
    if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(clean)) return false;
    if (/^(fc|fd|fe80)/i.test(clean)) return false;
    return /^[0-9a-fA-F.:]+$/.test(clean);
  }

  app.get('/api/geo', async (req, res) => {
    res.setHeader('Cache-Control', 'private, max-age=1800');
    const headerCountry = (
      req.header('cf-ipcountry') ||
      req.header('x-appengine-country') ||
      req.header('x-vercel-ip-country') ||
      req.header('cloudfront-viewer-country') ||
      req.header('x-country-code') ||
      ''
    )
      .trim()
      .toUpperCase();

    if (/^[A-Z]{2}$/.test(headerCountry) && headerCountry !== 'XX' && headerCountry !== 'T1') {
      res.json({
        countryCode: headerCountry,
        countryName: headerCountry,
        regionLanguage: mapCountryToMovixLanguage(headerCountry),
        source: 'header',
      });
      return;
    }

    const forwarded = req.header('x-forwarded-for') || '';
    const candidateIp = (forwarded.split(',')[0] || req.ip || '').replace(/^::ffff:/, '').trim();

    if (isPublicClientIp(candidateIp)) {
      const cached = geoCache.get(candidateIp);
      if (cached && cached.expiresAt > Date.now()) {
        res.json({
          countryCode: cached.countryCode,
          countryName: cached.countryName,
          regionLanguage: cached.regionLanguage,
          source: 'ip',
        });
        return;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2200);
        const geoResp = await fetch(`https://ipwho.is/${encodeURIComponent(candidateIp)}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        clearTimeout(timeout);
        if (geoResp.ok) {
          const data = (await geoResp.json()) as {
            success?: boolean;
            country_code?: string;
            country?: string;
          };
          if (data.success && typeof data.country_code === 'string' && /^[A-Z]{2}$/i.test(data.country_code)) {
            const cc = data.country_code.toUpperCase();
            const regionLanguage = mapCountryToMovixLanguage(cc);
            const countryName = typeof data.country === 'string' ? data.country.slice(0, 60) : cc;
            geoCache.set(candidateIp, {
              countryCode: cc,
              countryName,
              regionLanguage,
              expiresAt: Date.now() + 6 * 60 * 60 * 1000,
            });
            if (geoCache.size > 500) {
              const firstKey = geoCache.keys().next().value;
              if (firstKey) geoCache.delete(firstKey);
            }
            res.json({ countryCode: cc, countryName, regionLanguage, source: 'ip' });
            return;
          }
        }
      } catch {
        // Fall through to Accept-Language / browser timezone detection
      }
    }

    const acceptLang = mapAcceptLanguageToMovix(req.header('accept-language') || '');
    res.json({
      countryCode: null,
      countryName: null,
      regionLanguage: acceptLang,
      source: acceptLang ? 'accept-language' : 'browser',
    });
  });

  // ================= TMDB ROUTES =================
  app.use('/api/tmdb', (req, res, next) => {
    const requestedLang =
      (typeof req.query.lang === 'string' && req.query.lang) ||
      req.header('x-movix-lang') ||
      'pt-BR';
    res.setHeader('Vary', 'X-Movix-Lang');
    runWithTmdbLanguage(requestedLang, () => next());
  });

  app.get('/api/tmdb/home', async (_req, res) => {
    try {
      const data = await getHomeCatalog();
      res.setHeader('Cache-Control', 'public, max-age=120');
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar catálogo TMDB.';
      const status = msg === 'TMDB_NOT_CONFIGURED' ? 503 : 502;
      res.status(status).json({ error: msg, code: msg === 'TMDB_NOT_CONFIGURED' ? 'TMDB_NOT_CONFIGURED' : 'TMDB_ERROR' });
    }
  });

  app.get('/api/tmdb/genres', async (_req, res) => {
    try {
      const data = await getAllGenres();
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar géneros TMDB.';
      res.status(msg === 'TMDB_NOT_CONFIGURED' ? 503 : 502).json({ error: msg });
    }
  });

  app.get('/api/tmdb/movies', async (req, res) => {
    try {
      const data = await getMoviesCatalog({
        category: typeof req.query.category === 'string' ? req.query.category : undefined,
        genre: typeof req.query.genre === 'string' ? req.query.genre : undefined,
        year: typeof req.query.year === 'string' ? req.query.year : undefined,
        sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined,
        page: req.query.page ? Number(req.query.page) : 1,
      });
      res.setHeader('Cache-Control', 'public, max-age=120');
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar filmes.';
      res.status(msg === 'TMDB_NOT_CONFIGURED' ? 503 : 502).json({ error: msg, code: msg === 'TMDB_NOT_CONFIGURED' ? 'TMDB_NOT_CONFIGURED' : 'TMDB_ERROR' });
    }
  });

  app.get('/api/tmdb/series', async (req, res) => {
    try {
      const data = await getSeriesCatalog({
        category: typeof req.query.category === 'string' ? req.query.category : undefined,
        genre: typeof req.query.genre === 'string' ? req.query.genre : undefined,
        year: typeof req.query.year === 'string' ? req.query.year : undefined,
        sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined,
        page: req.query.page ? Number(req.query.page) : 1,
      });
      res.setHeader('Cache-Control', 'public, max-age=120');
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar séries.';
      res.status(msg === 'TMDB_NOT_CONFIGURED' ? 503 : 502).json({ error: msg, code: msg === 'TMDB_NOT_CONFIGURED' ? 'TMDB_NOT_CONFIGURED' : 'TMDB_ERROR' });
    }
  });

  app.get('/api/tmdb/section/:section', async (req, res) => {
    const section = req.params.section as ThematicSection;
    const validSections: ThematicSection[] = ['novelas', 'doramas', 'dramas', 'animes', 'infantil', 'documentarios'];
    if (!validSections.includes(section)) {
      res.status(400).json({ error: 'Secção temática inválida.' });
      return;
    }
    try {
      const data = await getSectionCatalog(section, {
        page: req.query.page ? Number(req.query.page) : 1,
        year: typeof req.query.year === 'string' ? req.query.year : undefined,
        sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined,
      });
      res.setHeader('Cache-Control', 'public, max-age=120');
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar secção.';
      res.status(msg === 'TMDB_NOT_CONFIGURED' ? 503 : 502).json({
        error: msg,
        code: msg === 'TMDB_NOT_CONFIGURED' ? 'TMDB_NOT_CONFIGURED' : 'TMDB_ERROR',
      });
    }
  });

  app.get('/api/tmdb/provider/:providerId', async (req, res) => {
    const providerId = Number(req.params.providerId);
    if (!Number.isInteger(providerId) || providerId <= 0) {
      res.status(400).json({ error: 'Plataforma inválida.' });
      return;
    }
    const rawMedia = typeof req.query.mediaType === 'string' ? req.query.mediaType : 'all';
    const mediaType: 'all' | 'movie' | 'tv' =
      rawMedia === 'movie' || rawMedia === 'tv' ? rawMedia : 'all';
    try {
      const data = await getStreamingProviderCatalog(
        providerId,
        mediaType,
        req.query.page ? Number(req.query.page) : 1
      );
      res.setHeader('Cache-Control', 'public, max-age=120');
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar catálogo da plataforma.';
      res.status(msg === 'TMDB_NOT_CONFIGURED' ? 503 : 502).json({
        error: msg,
        code: msg === 'TMDB_NOT_CONFIGURED' ? 'TMDB_NOT_CONFIGURED' : 'TMDB_ERROR',
      });
    }
  });

  // ================= PROTECTED ADULT (+18) ROUTES =================
  app.get('/api/adult/auth/status', (req, res) => {
    res.json(getAdultAuthStatus(req));
  });

  app.post('/api/adult/auth/setup', (req, res) => {
    const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
    const result = setupAdultPin(pin, false);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, token: result.token });
  });

  app.post('/api/adult/auth/unlock', (req, res) => {
    const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
    const result = unlockAdultContent(pin);
    if (!result.ok) {
      res.status(401).json({ error: result.error });
      return;
    }
    res.json({ ok: true, token: result.token });
  });

  app.get('/api/adult/catalog', requireAdultUnlocked, async (req, res) => {
    try {
      const page = req.query.page ? Number(req.query.page) : 1;
      const [tmdbData, megambdCats] = await Promise.all([
        getAdultCatalog(page),
        getMegambdCategories(true),
      ]);
      const adultMegambdCats = megambdCats.available
        ? megambdCats.vodCategories.filter((c) => /(\+18|18\+|adult|adulto|xxx|porn|erotic)/i.test(c.category_name))
        : [];
      res.json({
        ...tmdbData,
        megambdAvailable: megambdCats.available,
        megambdAdultCategories: adultMegambdCats,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar catálogo +18.';
      res.status(msg === 'TMDB_NOT_CONFIGURED' ? 503 : 502).json({ error: msg });
    }
  });

  app.get('/api/tmdb/movie/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'ID de filme inválido.' });
      return;
    }
    try {
      const data = await getMovieDetails(id);
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar detalhes do filme.';
      res.status(msg === 'TMDB_NOT_CONFIGURED' ? 503 : 502).json({ error: msg });
    }
  });

  app.get('/api/tmdb/tv/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'ID de série inválido.' });
      return;
    }
    try {
      const data = await getSeriesDetails(id);
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar detalhes da série.';
      res.status(msg === 'TMDB_NOT_CONFIGURED' ? 503 : 502).json({ error: msg });
    }
  });

  app.get('/api/tmdb/tv/:id/season/:seasonNumber', async (req, res) => {
    const id = Number(req.params.id);
    const seasonNumber = Number(req.params.seasonNumber);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(seasonNumber) || seasonNumber < 0) {
      res.status(400).json({ error: 'Parâmetros de temporada inválidos.' });
      return;
    }
    try {
      const data = await getSeriesSeason(id, seasonNumber);
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar episódios da temporada.';
      res.status(msg === 'TMDB_NOT_CONFIGURED' ? 503 : 502).json({ error: msg });
    }
  });

  app.get('/api/tmdb/search', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const type =
      req.query.type === 'movie' || req.query.type === 'tv' ? req.query.type : 'multi';
    const page = req.query.page ? Number(req.query.page) : 1;
    try {
      const data = await searchTmdb(query, type, page);
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro na pesquisa TMDB.';
      res.status(msg === 'TMDB_NOT_CONFIGURED' ? 503 : 502).json({ error: msg });
    }
  });

  // ================= MEGAMBD ROUTES =================
  app.get('/api/megambd/status', async (_req, res) => {
    const status = await getMegambdStatus(false);
    res.json(status);
  });

  app.get('/api/megambd/categories', async (_req, res) => {
    const data = await getMegambdCategories();
    res.json(data);
  });

  app.get('/api/megambd/vod', async (req, res) => {
    const data = await getMegambdVodStreams({
      categoryId: typeof req.query.category_id === 'string' ? req.query.category_id : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 24,
    });
    res.json(data);
  });

  app.get('/api/megambd/vod/:id', async (req, res) => {
    const id = req.params.id;
    if (!/^\d+$/.test(id)) {
      res.status(400).json({ error: 'ID VOD inválido.' });
      return;
    }
    const data = await getMegambdVodInfo(id);
    res.json(data);
  });

  app.get('/api/megambd/series', async (req, res) => {
    const data = await getMegambdSeriesList({
      categoryId: typeof req.query.category_id === 'string' ? req.query.category_id : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 24,
    });
    res.json(data);
  });

  app.get('/api/megambd/series/:id', async (req, res) => {
    const id = req.params.id;
    if (!/^\d+$/.test(id)) {
      res.status(400).json({ error: 'ID de série inválido.' });
      return;
    }
    const data = await getMegambdSeriesInfo(id);
    res.json(data);
  });

  app.get('/api/megambd/match', async (req, res) => {
    const mediaType = req.query.mediaType === 'tv' ? 'tv' : 'movie';
    const title = typeof req.query.title === 'string' ? req.query.title : '';
    const originalTitle = typeof req.query.originalTitle === 'string' ? req.query.originalTitle : undefined;
    const tmdbId = req.query.tmdbId ? Number(req.query.tmdbId) : undefined;
    const season = req.query.season ? Number(req.query.season) : undefined;
    const episode = req.query.episode ? Number(req.query.episode) : undefined;
    if (!title) {
      res.status(400).json({ error: 'Título obrigatório para pesquisa no catálogo MegamBD.' });
      return;
    }
    const match = await matchMegambdContent({
      mediaType,
      title,
      originalTitle,
      tmdbId,
      season: Number.isInteger(season) ? season : undefined,
      episode: Number.isInteger(episode) ? episode : undefined,
    });
    res.json(match);
  });

  // ================= STREAM PROXY ROUTES =================
  app.get('/api/stream/vod/:id', (req, res) => {
    void handleMediaStreamProxy(req, res, 'movie');
  });

  app.get('/api/stream/series/:id', (req, res) => {
    void handleMediaStreamProxy(req, res, 'series');
  });

  // ================= ADMIN AUTH & MANAGEMENT ROUTES =================
  app.get('/api/admin/auth/status', (req, res) => {
    res.json(getAdminAuthStatus(req));
  });

  app.post('/api/admin/auth/setup', (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const name = typeof req.body?.name === 'string' ? req.body.name : undefined;
    const email = typeof req.body?.email === 'string' ? req.body.email : undefined;
    const result = setupInitialAdmin(password, name, email);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, token: result.token, admin: result.admin });
  });

  app.use('/api/admin', (req, res, next) => {
    if (
      (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') &&
      !req.path.startsWith('/auth/')
    ) {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          broadcastConfigSyncEvent();
        }
      });
    }
    next();
  });

  app.post('/api/admin/auth/login', (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const email = typeof req.body?.email === 'string' ? req.body.email : undefined;
    const result = loginAdmin(password, email);
    if (!result.ok) {
      res.status(401).json({ error: result.error });
      return;
    }
    res.json({ ok: true, token: result.token, admin: result.admin });
  });

  app.post('/api/admin/auth/firebase-login', async (req, res) => {
    const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken : '';
    const result = await loginAdminWithFirebaseIdToken(idToken);
    if (!result.ok) {
      res.status(401).json({ error: result.error });
      return;
    }
    res.json({ ok: true, token: result.token, admin: result.admin });
  });

  app.post('/api/admin/auth/change-password', requireAdmin, (req, res) => {
    if (!req.adminSession) {
      res.status(401).json({ error: 'Sessão administrativa inválida.' });
      return;
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const email = typeof req.body?.email === 'string' ? req.body.email : undefined;
    const result = updateOwnAdminPassword(req.adminSession, password, email);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, admin: result.admin });
  });

  app.get('/api/admin/dashboard', requireAdmin, async (_req, res) => {
    const store = getStore();
    const configStatus = getPublicConfigStatus();
    const megambdStatus = await getMegambdStatus(false);
    res.json({
      configStatus,
      megambdStatus,
      cacheStats: getCacheStats(),
      banners: store.banners,
      highlights: store.highlights,
      categories: store.categories,
      errorLogs: store.errorLogs,
    });
  });

  app.post('/api/admin/diagnostics/test-apis', requireAdmin, async (_req, res) => {
    const [tmdb, megambd] = await Promise.all([testTmdbAuth(), getMegambdStatus(true)]);
    let vodCatCount = 0;
    let seriesCatCount = 0;
    if (megambd.authValid) {
      const cats = await getMegambdCategories();
      vodCatCount = cats.vodCategories.length;
      seriesCatCount = cats.seriesCategories.length;
    }
    res.json({
      testedAt: new Date().toISOString(),
      tmdb,
      megambd: {
        ...megambd,
        vodCategoriesCount: vodCatCount,
        seriesCategoriesCount: seriesCatCount,
      },
      errorLogs: getStore().errorLogs,
    });
  });

  app.put('/api/admin/banners', requireAdmin, (req, res) => {
    const list = Array.isArray(req.body?.banners) ? (req.body.banners as BannerItem[]) : null;
    if (!list) {
      res.status(400).json({ error: 'Lista de banners inválida.' });
      return;
    }
    const sanitized: BannerItem[] = list.map((b, idx) => ({
      id: String(b.id || `banner-${Date.now()}-${idx}`),
      title: String(b.title || '').slice(0, 140),
      subtitle: String(b.subtitle || '').slice(0, 400),
      tmdbId: typeof b.tmdbId === 'number' ? b.tmdbId : null,
      mediaType: b.mediaType === 'tv' ? 'tv' : 'movie',
      backdropUrl: String(b.backdropUrl || '').slice(0, 500),
      posterUrl: String(b.posterUrl || '').slice(0, 500),
      year: String(b.year || '').slice(0, 10),
      rating: Number(b.rating || 0),
      genres: Array.isArray(b.genres) ? b.genres.map(String).slice(0, 5) : [],
      active: Boolean(b.active),
      order: Number.isFinite(b.order) ? Number(b.order) : idx + 1,
    }));
    res.json({ banners: setBanners(sanitized) });
  });

  app.put('/api/admin/highlights', requireAdmin, (req, res) => {
    const list = Array.isArray(req.body?.highlights) ? (req.body.highlights as HighlightItem[]) : null;
    if (!list) {
      res.status(400).json({ error: 'Lista de destaques inválida.' });
      return;
    }
    const sanitized: HighlightItem[] = list.map((h, idx) => ({
      id: String(h.id || `hl-${Date.now()}-${idx}`),
      tmdbId: Number(h.tmdbId || 0),
      mediaType: h.mediaType === 'tv' ? 'tv' : 'movie',
      title: String(h.title || '').slice(0, 140),
      posterUrl: String(h.posterUrl || '').slice(0, 500),
      backdropUrl: String(h.backdropUrl || '').slice(0, 500),
      year: String(h.year || '').slice(0, 10),
      rating: Number(h.rating || 0),
      label: String(h.label || 'Em Destaque').slice(0, 40),
      active: Boolean(h.active),
      order: Number.isFinite(h.order) ? Number(h.order) : idx + 1,
    }));
    res.json({ highlights: setHighlights(sanitized) });
  });

  app.put('/api/admin/categories', requireAdmin, (req, res) => {
    const list = Array.isArray(req.body?.categories) ? (req.body.categories as ManagedCategory[]) : null;
    if (!list) {
      res.status(400).json({ error: 'Lista de categorias inválida.' });
      return;
    }
    const sanitized: ManagedCategory[] = list.map((c, idx) => ({
      id: String(c.id || `cat-${idx}`),
      name: String(c.name || '').slice(0, 80),
      source: c.source === 'megambd' ? 'megambd' : 'tmdb',
      externalId: String(c.externalId || 'popular').slice(0, 60),
      mediaType: c.mediaType === 'tv' ? 'tv' : 'movie',
      imageUrl: typeof c.imageUrl === 'string' ? c.imageUrl.slice(0, 500) : '',
      visible: Boolean(c.visible),
      order: Number.isFinite(c.order) ? Number(c.order) : idx + 1,
    }));
    res.json({ categories: setCategories(sanitized) });
  });

  app.put('/api/admin/env', requireAdmin, (req, res) => {
    const body = req.body || {};
    const updateRes = updateRuntimeConfig({
      tmdbApiKey: typeof body.tmdbApiKey === 'string' ? body.tmdbApiKey : undefined,
      tmdbReadToken: typeof body.tmdbReadToken === 'string' ? body.tmdbReadToken : undefined,
      tmdbBaseUrl: typeof body.tmdbBaseUrl === 'string' ? body.tmdbBaseUrl : undefined,
      megambdServerUrl: typeof body.megambdServerUrl === 'string' ? body.megambdServerUrl : undefined,
      megambdEmbedUrl: typeof body.megambdEmbedUrl === 'string' ? body.megambdEmbedUrl : undefined,
      megambdApiKey: typeof body.megambdApiKey === 'string' ? body.megambdApiKey : undefined,
      megambdUsername: typeof body.megambdUsername === 'string' ? body.megambdUsername : undefined,
      megambdPassword: typeof body.megambdPassword === 'string' ? body.megambdPassword : undefined,
      firebaseServiceAccountJson:
        typeof body.firebaseServiceAccountJson === 'string'
          ? body.firebaseServiceAccountJson
          : undefined,
    });
    if (!updateRes.ok) {
      res.status(400).json({ error: updateRes.error });
      return;
    }
    clearCache();
    res.json({ ok: true, configStatus: getPublicConfigStatus() });
  });

  app.post('/api/admin/cache/clear', requireAdmin, (_req, res) => {
    const cleared = clearCache();
    res.json({ ok: true, cleared, cacheStats: getCacheStats() });
  });

  app.delete('/api/admin/errors', requireAdmin, (_req, res) => {
    clearErrorLogs();
    res.json({ ok: true, errorLogs: [] });
  });

  app.put('/api/admin/adult-pin', requireAdmin, (req, res) => {
    const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
    const result = setupAdultPin(pin, true);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  // ================= PUSH NOTIFICATIONS (FCM) ROUTES =================
  app.post('/api/push/subscribe', async (req, res) => {
    const fcmToken = typeof req.body?.fcm_token === 'string' ? req.body.fcm_token.trim() : '';
    if (!fcmToken || fcmToken.length < 12 || fcmToken.length > 512) {
      res.status(400).json({ error: 'Token FCM inválido.' });
      return;
    }
    const userId =
      typeof req.body?.user_id === 'string' && req.body.user_id.trim()
        ? req.body.user_id.trim().slice(0, 128)
        : null;
    const deviceInfo =
      typeof req.body?.device_info === 'string' ? req.body.device_info.trim().slice(0, 200) : 'Web Browser';
    const rawPrefs =
      req.body?.prefs && typeof req.body.prefs === 'object' ? (req.body.prefs as Partial<PushPrefs>) : undefined;

    const { record } = upsertPushSubscription({
      user_id: userId,
      fcm_token: fcmToken,
      device_info: deviceInfo,
      prefs: rawPrefs,
    });

    const welcomeResult = await dispatchWelcomePushIfNeeded(record);

    res.json({
      ok: true,
      subscription: {
        id: record.id,
        user_id: record.user_id,
        welcome_sent: true,
        prefs: record.prefs,
      },
      welcomeTriggered: welcomeResult.welcomeTriggered,
      welcomeFcmSent: welcomeResult.fcmSent,
      welcomePayload: welcomeResult.welcomeTriggered ? welcomeResult.payload : null,
    });
  });

  app.get('/api/push/subscription', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (!token) {
      res.json({ found: false, subscription: null });
      return;
    }
    const record = getPushSubscriptionByToken(token);
    if (!record) {
      res.json({ found: false, subscription: null });
      return;
    }
    res.json({
      found: true,
      subscription: {
        id: record.id,
        user_id: record.user_id,
        welcome_sent: record.welcome_sent,
        prefs: record.prefs,
      },
    });
  });

  app.patch('/api/push/preferences', (req, res) => {
    const fcmToken = typeof req.body?.fcm_token === 'string' ? req.body.fcm_token.trim() : '';
    const prefs =
      req.body?.prefs && typeof req.body.prefs === 'object' ? (req.body.prefs as Partial<PushPrefs>) : null;
    const userId =
      typeof req.body?.user_id === 'string' && req.body.user_id.trim()
        ? req.body.user_id.trim().slice(0, 128)
        : undefined;

    if (!fcmToken || !prefs) {
      res.status(400).json({ error: 'Token e preferências são obrigatórios.' });
      return;
    }
    const updated = updatePushSubscriptionPrefs(fcmToken, prefs, userId);
    if (!updated) {
      const created = upsertPushSubscription({
        fcm_token: fcmToken,
        user_id: userId ?? null,
        prefs,
      });
      res.json({ ok: true, prefs: created.record.prefs });
      return;
    }
    res.json({ ok: true, prefs: updated.prefs });
  });

  // Universal cross-browser real-time notification stream (Safari, Firefox, Brave, Opera, Edge, Chrome, WebView)
  app.get('/api/push/stream', (req, res) => {
    const token =
      typeof req.query.token === 'string' && req.query.token.trim().length >= 8
        ? req.query.token.trim().slice(0, 512)
        : `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const sinceRaw = typeof req.query.since === 'string' ? Number(req.query.since) : 0;
    const sinceMs = Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : Date.now();

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(': connected\n\n');

    // Replay any recent broadcast missed during reconnect
    const missed = getRecentBroadcastsSince(sinceMs, token);
    for (const ev of missed) {
      res.write(
        `event: notification\ndata: ${JSON.stringify({
          campaignId: ev.campaignId,
          title: ev.title,
          body: ev.body,
          image_url: ev.image_url,
          target_url: ev.target_url,
          category: ev.category,
          createdAt: ev.createdAt,
        })}\n\n`
      );
    }

    const unregister = registerPushSseClient(token, (chunk) => {
      res.write(chunk);
    });

    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
        unregister();
      }
    }, 25_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unregister();
    });
  });

  // Protected Admin Push Center endpoints
  app.get('/api/admin/notifications/overview', requireAdmin, (_req, res) => {
    res.json(getPushOverviewStats());
  });

  app.post('/api/admin/notifications/send', requireAdmin, async (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!title || !body) {
      res.status(400).json({ error: 'Título e mensagem são obrigatórios.' });
      return;
    }
    const image_url = typeof req.body?.image_url === 'string' ? req.body.image_url : '';
    const target_url = typeof req.body?.target_url === 'string' ? req.body.target_url : '#/';
    const category = sanitizePushCategory(req.body?.category);
    const scheduled_for =
      typeof req.body?.scheduled_for === 'string' && req.body.scheduled_for.trim()
        ? req.body.scheduled_for.trim()
        : null;

    const campaign = await sendOrScheduleAdminCampaign({
      title,
      body,
      image_url,
      target_url,
      category,
      scheduled_for,
    });
    res.json({ ok: true, campaign, overview: getPushOverviewStats() });
  });

  app.delete('/api/admin/notifications/scheduled/:id', requireAdmin, (req, res) => {
    const removed = deleteScheduledPushCampaign(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Agendamento não encontrado ou já enviado.' });
      return;
    }
    res.json({ ok: true, overview: getPushOverviewStats() });
  });

  const httpServer = http.createServer(app);

  // Frontend serving: Vite middleware in development, dist/ in production
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distDir, {
        maxAge: '1d',
        setHeaders(res, filePath) {
          const base = path.basename(filePath);
          if (
            base === 'index.html' ||
            base === 'sw.js' ||
            base === 'registerSW.js' ||
            base === 'firebase-messaging-sw.js' ||
            base === 'manifest.webmanifest' ||
            base === 'version.json'
          ) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          }
        },
      })
    );
    app.get('/{*splat}', (req, res) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Endpoint não encontrado.' });
        return;
      }
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  startPushScheduler();

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`MOVIX server listening on http://0.0.0.0:${PORT}`);
  });
}

void createAppServer();
