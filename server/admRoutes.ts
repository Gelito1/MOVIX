import crypto from 'crypto';
import express, { type Request, type Router } from 'express';
import fs from 'fs';
import net from 'net';
import path from 'path';
import {
  ALL_ADMIN_PERMISSIONS,
  BACKUPS_DIR,
  DEFAULT_AD_PACING,
  ROLE_DEFAULT_PERMISSIONS,
  appendAuditLog,
  getAdmStore,
  getOrCreateDailyBucket,
  recordPlatformView,
  refreshAdStatuses,
  replaceAdmStore,
  saveAdmStore,
  todayDateKey,
  type AdCampaign,
  type AdDeviceTarget,
  type AdFormatType,
  type AdPacingConfig,
  type AdPlacement,
  type AdStatus,
  type AdminAccount,
  type AdminPermission,
  type AdminRole,
  type AdmStoreData,
  type GlobalPlaybackServer,
  type ManagedEpisode,
  type ManagedGenre,
  type ManagedMovie,
  type ManagedSeason,
  type ManagedSeries,
  type PlaybackServerLink,
} from './admStore.ts';
import {
  localizePublicAds,
  normalizeSupportedLang,
  prewarmAdTranslations,
  translateAdTextsBatch,
} from './adTranslator.ts';
import {
  hashPasswordScrypt,
  requireAdmin,
  requireAdminPermission,
  revokeAllAdminSessions,
} from './auth.ts';
import { broadcastConfigSyncEvent, sendOrScheduleAdminCampaign } from './push.ts';
import {
  getStore,
  setBanners,
  setCategories,
  setHighlights,
  type BannerItem,
  type HighlightItem,
  type ManagedCategory,
} from './store.ts';
import { getMovieDetails, getSeriesDetails, getSeriesSeason } from './tmdb.ts';
import {
  deleteMediaFile,
  listAllMediaFiles,
  restoreUploadedBuffer,
  sanitizeFolder,
  saveUploadedBuffer,
  serveMediaFile,
} from './uploads.ts';

function safeUrl(raw: unknown, allowRelative = true): string {
  const str = typeof raw === 'string' ? raw.trim().slice(0, 600) : '';
  if (!str) return '';
  if (allowRelative && (str.startsWith('/') || str.startsWith('#/'))) {
    return str.startsWith('//') ? '' : str;
  }
  try {
    const parsed = new URL(str);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // invalid URL
  }
  return '';
}

function safeDestinationUrl(raw: unknown): string {
  const str = typeof raw === 'string' ? raw.trim().slice(0, 600) : '';
  if (!str || /[\u0000-\u001F\s]/.test(str)) return '';
  if (str.startsWith('#/')) return str;
  if (str.startsWith('/')) return str.startsWith('//') ? '' : str;
  const candidate =
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(str) &&
    /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+([/:?#].*)?$/.test(str)
      ? `https://${str}`
      : str;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // invalid URL
  }
  return '';
}

function isPrivateOrBlockedHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '0.0.0.0' || h === '169.254.169.254') return true;
  if (net.isIP(h)) {
    if (h.startsWith('127.') || h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('169.254.')) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    if (/^(fc|fd|fe80)/i.test(h)) return true;
  }
  return false;
}

function sanitizeServers(input: unknown): PlaybackServerLink[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item, idx) => {
      const obj = (item || {}) as Partial<PlaybackServerLink>;
      const url = safeUrl(obj.url, true);
      if (!url) return null;
      return {
        id: String(obj.id || `srv_${Date.now().toString(36)}_${idx}`),
        name: String(obj.name || `Servidor ${idx + 1}`).slice(0, 80),
        url,
        language:
          obj.language === 'legendado' || obj.language === 'dual' ? obj.language : 'dublado',
        quality: String(obj.quality || 'HD 1080p').slice(0, 30),
        type: obj.type === 'stream' ? 'stream' : 'embed',
        active: obj.active !== false,
        order: Number.isFinite(obj.order) ? Number(obj.order) : idx + 1,
      };
    })
    .filter((x): x is PlaybackServerLink => Boolean(x))
    .slice(0, 20);
}

function audit(
  req: Request,
  action: string,
  entityType: string,
  entityId: string,
  details: string,
  result: 'success' | 'error' = 'success'
) {
  const s = req.adminSession;
  appendAuditLog({
    adminId: s?.adminId || 'principal',
    adminName: s?.name || 'Administrador',
    adminEmail: s?.email || 'admin@movix.app',
    adminRole: s?.adminRole || 'super_admin',
    action,
    entityType,
    entityId,
    details: details.slice(0, 240),
    result,
  });
}

// Anti-duplicate ad event throttle cache (key: ip:adId:event -> timestamp)
const adEventThrottle = new Map<string, number>();

function isBotUserAgent(ua: string): boolean {
  return /(bot|crawl|spider|slurp|headless|phantom|curl|wget|python-requests)/i.test(ua || '');
}

export function createAdmRouter(): Router {
  const router = express.Router();

  // Broadcast live synchronization signal to all connected MOVIX browsers on every ADM write
  router.use('/api/adm', (req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          broadcastConfigSyncEvent();
        }
      });
    }
    next();
  });

  // =========================================================================
  // PUBLIC MEDIA SERVING (Range-supported images & videos uploaded via ADM)
  // =========================================================================
  router.get('/api/media/:folder/:filename', serveMediaFile);

  // =========================================================================
  // PUBLIC TELEMETRY, USER SYNC & MOVIX ADS DELIVERY
  // =========================================================================
  router.post('/api/analytics/view', (req, res) => {
    const mediaType = req.body?.mediaType === 'tv' ? 'tv' : 'movie';
    const id = String(req.body?.id || '').trim().slice(0, 80);
    const title = String(req.body?.title || '').trim().slice(0, 140);
    const posterUrl = safeUrl(req.body?.posterUrl, true);
    const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim().slice(0, 128) : undefined;
    if (!id || !title) {
      res.status(400).json({ error: 'ID e título são obrigatórios.' });
      return;
    }
    recordPlatformView({ mediaType, id, title, posterUrl, userId });
    res.json({ ok: true });
  });

  router.post('/api/users/sync', (req, res) => {
    const uid = typeof req.body?.uid === 'string' ? req.body.uid.trim().slice(0, 128) : '';
    if (!uid || !/^[a-zA-Z0-9_-]+$/.test(uid)) {
      res.status(400).json({ error: 'UID inválido.' });
      return;
    }
    const store = getAdmStore();
    const now = new Date().toISOString();
    const bucket = getOrCreateDailyBucket();
    if (!bucket.activeUserIds.includes(uid)) {
      bucket.activeUserIds.push(uid);
    }

    let record = store.users.find((u) => u.uid === uid);
    if (!record) {
      bucket.newUsers += 1;
      record = {
        uid,
        displayName: String(req.body?.displayName || 'Utilizador MOVIX').trim().slice(0, 80),
        email: String(req.body?.email || '').trim().toLowerCase().slice(0, 180),
        photoURL: safeUrl(req.body?.photoURL, true),
        provider: String(req.body?.provider || 'email').slice(0, 30),
        preferredLanguage: String(req.body?.preferredLanguage || 'pt-BR').slice(0, 12),
        status: 'active',
        role: 'user',
        favoritesCount: Math.max(0, Number(req.body?.favoritesCount || 0)),
        watchCount: 0,
        recentTitles: [],
        createdAt: now,
        lastActiveAt: now,
      };
      store.users.unshift(record);
    } else {
      if (typeof req.body?.displayName === 'string' && req.body.displayName.trim()) {
        record.displayName = req.body.displayName.trim().slice(0, 80);
      }
      if (typeof req.body?.email === 'string' && req.body.email.trim()) {
        record.email = req.body.email.trim().toLowerCase().slice(0, 180);
      }
      if (typeof req.body?.photoURL === 'string') {
        record.photoURL = safeUrl(req.body.photoURL, true);
      }
      if (typeof req.body?.preferredLanguage === 'string') {
        record.preferredLanguage = req.body.preferredLanguage.slice(0, 12);
      }
      if (typeof req.body?.favoritesCount === 'number') {
        record.favoritesCount = Math.max(0, Math.floor(req.body.favoritesCount));
      }
      record.lastActiveAt = now;
    }
    saveAdmStore();
    res.json({ ok: true, status: record.status, role: record.role });
  });

  // Public active ads feed filtered by placement & device, with fair showcase cross-placement rotation
  const SHOWCASE_PLACEMENTS = new Set<AdPlacement>([
    'home',
    'between_movies',
    'categories_page',
    'movie_detail',
    'series_detail',
  ]);

  router.get('/api/ads/active', async (req, res) => {
    refreshAdStatuses();
    const store = getAdmStore();
    if (!store.siteConfig.adsGlobalEnabled) {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ enabled: false, ads: [] });
      return;
    }
    const placement = typeof req.query.placement === 'string' ? req.query.placement.trim() : '';
    const device =
      req.query.device === 'mobile' || req.query.device === 'tablet' || req.query.device === 'desktop'
        ? req.query.device
        : 'all';
    const targetLang = normalizeSupportedLang(req.query.lang);
    const isShowcaseSlot = SHOWCASE_PLACEMENTS.has(placement as AdPlacement);

    const eligible = store.ads.filter((ad) => {
      if (ad.status !== 'active') return false;
      if (device !== 'all' && !ad.devices.includes('all') && !ad.devices.includes(device)) return false;
      if (ad.maxImpressions !== null && ad.maxImpressions > 0 && ad.impressions >= ad.maxImpressions) return false;
      if (!placement) return true;
      if (ad.placements.includes(placement as AdPlacement)) return true;
      // Allow active showcase campaigns to rotate across showcase locations so no ad stays locked in 1 place
      if (isShowcaseSlot && ad.placements.some((p) => SHOWCASE_PLACEMENTS.has(p))) {
        return true;
      }
      return false;
    });

    const localizedMap = await localizePublicAds(eligible, targetLang);

    const active = eligible
      .sort((a, b) => {
        const aExact = !placement || a.placements.includes(placement as AdPlacement) ? 0 : 1;
        const bExact = !placement || b.placements.includes(placement as AdPlacement) ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        return b.priority - a.priority;
      })
      .map((ad) => {
        const localized = localizedMap.get(ad.id);
        return {
          id: ad.id,
          name: localized?.name || ad.name,
          title: localized?.title ?? ad.title,
          description: localized?.description ?? ad.description,
          format: ad.format,
          mediaKind: ad.mediaKind,
          imageUrl: ad.imageUrl,
          videoUrl: ad.videoUrl,
          destinationUrl: ad.destinationUrl,
          ctaText: localized?.ctaText ?? ad.ctaText,
          placements: ad.placements,
          priority: ad.priority,
          frequencyPerSession: ad.frequencyPerSession,
          autoplay: ad.autoplay,
          startMuted: ad.startMuted,
          skippable: ad.skippable,
          skipAfterSeconds: ad.skipAfterSeconds,
          durationSeconds: ad.durationSeconds,
        };
      });

    const pacing: AdPacingConfig = {
      ...DEFAULT_AD_PACING,
      ...(store.siteConfig.adPacing || {}),
    };

    const inactiveAds = store.ads
      .filter((ad) => ad.status !== 'active')
      .map((ad) => ({
        id: ad.id,
        status: ad.status,
        updatedAt: ad.updatedAt,
      }));

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      enabled: true,
      pacing,
      ads: active,
      inactiveAds,
      totalStoredAds: store.ads.length,
    });
  });

  // Translate cloud-synced ad copy & CTA buttons into the visitor's active language
  router.post('/api/ads/translate-texts', async (req, res) => {
    const targetLang = normalizeSupportedLang(req.body?.lang);
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const safeItems = rawItems
      .slice(0, 20)
      .filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item: Record<string, unknown>) => ({
        id: String(item.id || '').trim().slice(0, 128),
        title: String(item.title || '').trim().slice(0, 200),
        description: String(item.description || '').trim().slice(0, 600),
        ctaText: String(item.ctaText || '').trim().slice(0, 80),
      }))
      .filter((item: { id: string }) => item.id.length > 0);

    if (safeItems.length === 0) {
      res.json({ translations: {} });
      return;
    }

    try {
      const translations = await translateAdTextsBatch(safeItems, targetLang);
      res.json({ translations });
    } catch {
      res.json({ translations: {} });
    }
  });

  // Safe same-origin audio source proxy for external HTTPS ad videos (strictly keyed by ad.id — zero SSRF)
  router.get('/api/ads/:id/audio-source', async (req, res) => {
    const store = getAdmStore();
    const ad = store.ads.find((a) => a.id === req.params.id && a.mediaKind === 'video' && Boolean(a.videoUrl));
    if (!ad || !ad.videoUrl) {
      res.status(404).json({ error: 'Fonte de vídeo não encontrada.' });
      return;
    }
    if (ad.videoUrl.startsWith('/')) {
      res.redirect(302, ad.videoUrl);
      return;
    }
    try {
      const parsed = new URL(ad.videoUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        res.status(400).end();
        return;
      }
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host.startsWith('127.') ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        host === '169.254.169.254' ||
        host === '[::1]'
      ) {
        res.status(403).end();
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const upstream = await fetch(parsed.toString(), { signal: controller.signal });
      clearTimeout(timeout);
      if (!upstream.ok) {
        res.status(502).end();
        return;
      }
      const contentLen = Number(upstream.headers.get('content-length') || 0);
      if (contentLen > 35 * 1024 * 1024) {
        res.status(413).end();
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.byteLength > 35 * 1024 * 1024) {
        res.status(413).end();
        return;
      }
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(buf);
    } catch {
      if (!res.headersSent) res.status(502).end();
    }
  });

  // Track real ad impressions, clicks & video views with anti-duplicate protection
  router.post('/api/ads/:id/event', (req, res) => {
    const ua = String(req.headers['user-agent'] || '');
    if (isBotUserAgent(ua)) {
      res.json({ ok: true, ignored: 'bot' });
      return;
    }

    const adId = req.params.id;
    const eventType = String(req.body?.event || '');
    const device: 'desktop' | 'mobile' | 'tablet' =
      req.body?.device === 'mobile' || req.body?.device === 'tablet' ? req.body.device : 'desktop';
    const watchSeconds = Math.max(0, Math.min(600, Number(req.body?.watchSeconds || 0)));

    if (!['impression', 'click', 'video_start', 'video_partial', 'video_complete'].includes(eventType)) {
      res.status(400).json({ error: 'Tipo de evento inválido.' });
      return;
    }

    const ip = String(req.headers['x-forwarded-for'] || req.ip || 'anon').split(',')[0].trim();
    const sessionKey = String(req.body?.sessionId || ip).slice(0, 64);
    const throttleKey = `${sessionKey}:${adId}:${eventType}`;
    const lastTs = adEventThrottle.get(throttleKey) || 0;
    const cooldownMs = eventType === 'click' ? 4000 : 12_000;
    if (Date.now() - lastTs < cooldownMs) {
      res.json({ ok: true, deduplicated: true });
      return;
    }
    adEventThrottle.set(throttleKey, Date.now());
    if (adEventThrottle.size > 4000) {
      const oldest = adEventThrottle.keys().next().value;
      if (oldest) adEventThrottle.delete(oldest);
    }

    const store = getAdmStore();
    const ad = store.ads.find((a) => a.id === adId);
    if (!ad) {
      res.status(404).json({ error: 'Campanha não encontrada.' });
      return;
    }

    const dateKey = todayDateKey();
    let day = ad.dailyStats.find((d) => d.date === dateKey);
    if (!day) {
      day = { date: dateKey, impressions: 0, clicks: 0, videoViews: 0, videoCompletes: 0, watchSeconds: 0 };
      ad.dailyStats.push(day);
      if (ad.dailyStats.length > 90) ad.dailyStats = ad.dailyStats.slice(-90);
    }

    const platformDay = getOrCreateDailyBucket(dateKey);

    if (eventType === 'impression') {
      ad.impressions += 1;
      ad.byDevice[device].impressions += 1;
      day.impressions += 1;
      platformDay.adImpressions += 1;
    } else if (eventType === 'click') {
      ad.clicks += 1;
      ad.byDevice[device].clicks += 1;
      day.clicks += 1;
      platformDay.adClicks += 1;
    } else if (eventType === 'video_start') {
      ad.videoViews += 1;
      day.videoViews += 1;
    } else if (eventType === 'video_partial') {
      ad.videoPartials += 1;
      ad.totalWatchSeconds += watchSeconds;
      day.watchSeconds += watchSeconds;
    } else if (eventType === 'video_complete') {
      ad.videoCompletes += 1;
      ad.totalWatchSeconds += watchSeconds;
      day.videoCompletes += 1;
      day.watchSeconds += watchSeconds;
    }

    refreshAdStatuses();
    saveAdmStore();
    res.json({ ok: true });
  });

  // Public custom catalog lookup for MOVIX site synchronization
  router.get('/api/catalog/custom/movie/:id', (req, res) => {
    const rawId = req.params.id;
    const store = getAdmStore();
    const movie = store.movies.find(
      (m) => m.published && (m.id === rawId || (m.tmdbId !== null && String(m.tmdbId) === rawId))
    );
    if (!movie) {
      res.status(404).json({ error: 'Filme não encontrado.' });
      return;
    }
    res.json({ movie });
  });

  router.get('/api/catalog/custom/series/:id', (req, res) => {
    const rawId = req.params.id;
    const store = getAdmStore();
    const series = store.series.find(
      (s) => s.published && (s.id === rawId || (s.tmdbId !== null && String(s.tmdbId) === rawId))
    );
    if (!series) {
      res.status(404).json({ error: 'Série não encontrada.' });
      return;
    }
    res.json({
      series: {
        ...series,
        seasons: series.seasons
          .filter((sea) => sea.published)
          .map((sea) => ({ ...sea, episodes: sea.episodes.filter((ep) => ep.published) })),
      },
    });
  });

  // =========================================================================
  // PROTECTED MOVIX ADM — DASHBOARD & ANALYTICS
  // =========================================================================
  router.get('/api/adm/overview', requireAdminPermission('dashboard'), (req, res) => {
    refreshAdStatuses();
    const store = getAdmStore();
    const baseStore = getStore();
    const range = String(req.query.range || '30d');
    const customFrom = typeof req.query.from === 'string' ? req.query.from : '';
    const customTo = typeof req.query.to === 'string' ? req.query.to : '';

    const today = todayDateKey();
    const nowMs = Date.now();
    const rangeDays = range === '1d' ? 1 : range === '7d' ? 7 : range === '90d' ? 90 : 30;
    const minDate =
      range === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(customFrom)
        ? customFrom
        : new Date(nowMs - (rangeDays - 1) * 86_400_000).toISOString().slice(0, 10);
    const maxDate =
      range === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(customTo) ? customTo : today;

    const filteredDaily = store.analytics.daily
      .filter((d) => d.date >= minDate && d.date <= maxDate)
      .map((d) => ({
        date: d.date,
        views: d.views,
        movieViews: d.movieViews,
        seriesViews: d.seriesViews,
        newUsers: d.newUsers,
        activeUsers: d.activeUserIds.length,
        adImpressions: d.adImpressions,
        adClicks: d.adClicks,
      }));

    const todayBucket = store.analytics.daily.find((d) => d.date === today);
    const totalSeasons = store.series.reduce((sum, s) => sum + s.seasons.length, 0);
    const totalEpisodes = store.series.reduce(
      (sum, s) => sum + s.seasons.reduce((acc, sea) => acc + sea.episodes.length, 0),
      0
    );
    const sevenDaysAgoIso = new Date(nowMs - 7 * 86_400_000).toISOString();
    const activeUsers = store.users.filter((u) => u.status === 'active' && u.lastActiveAt >= sevenDaysAgoIso).length;

    const activeAds = store.ads.filter((a) => a.status === 'active').length;
    const totalAdImpressions = store.ads.reduce((sum, a) => sum + a.impressions, 0);
    const totalAdClicks = store.ads.reduce((sum, a) => sum + a.clicks, 0);

    const topMovies = [
      ...store.analytics.topContent.filter((c) => c.mediaType === 'movie'),
      ...store.movies
        .filter((m) => !store.analytics.topContent.some((c) => c.mediaType === 'movie' && (c.id === m.id || c.id === String(m.tmdbId))))
        .map((m) => ({
          key: `movie:${m.id}`,
          mediaType: 'movie' as const,
          id: m.id,
          title: m.title,
          posterUrl: m.posterUrl,
          views: m.views,
          lastViewedAt: m.updatedAt,
        })),
    ]
      .sort((a, b) => b.views - a.views)
      .slice(0, 6);

    const topSeries = [
      ...store.analytics.topContent.filter((c) => c.mediaType === 'tv'),
      ...store.series
        .filter((s) => !store.analytics.topContent.some((c) => c.mediaType === 'tv' && (c.id === s.id || c.id === String(s.tmdbId))))
        .map((s) => ({
          key: `tv:${s.id}`,
          mediaType: 'tv' as const,
          id: s.id,
          title: s.title,
          posterUrl: s.posterUrl,
          views: s.views,
          lastViewedAt: s.updatedAt,
        })),
    ]
      .sort((a, b) => b.views - a.views)
      .slice(0, 6);

    const recentContent = [
      ...store.movies.map((m) => ({
        id: m.id,
        mediaType: 'movie' as const,
        title: m.title,
        posterUrl: m.posterUrl,
        published: m.published,
        createdAt: m.createdAt,
      })),
      ...store.series.map((s) => ({
        id: s.id,
        mediaType: 'tv' as const,
        title: s.title,
        posterUrl: s.posterUrl,
        published: s.published,
        createdAt: s.createdAt,
      })),
    ]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8);

    res.json({
      kpis: {
        totalMovies: store.movies.length,
        publishedMovies: store.movies.filter((m) => m.published).length,
        totalSeries: store.series.length,
        publishedSeries: store.series.filter((s) => s.published).length,
        totalSeasons,
        totalEpisodes,
        totalUsers: store.users.length,
        activeUsers,
        totalViews: store.analytics.totalViews,
        todayViews: todayBucket?.views || 0,
        activeAds,
        totalAds: store.ads.length,
        adImpressions: totalAdImpressions,
        adClicks: totalAdClicks,
        adCtr: totalAdImpressions > 0 ? Number(((totalAdClicks / totalAdImpressions) * 100).toFixed(2)) : 0,
        pushSubscribers: baseStore.pushSubscriptions.length,
      },
      dailySeries: filteredDaily,
      topMovies,
      topSeries,
      recentContent,
      topAds: [...store.ads]
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 6)
        .map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status,
          format: a.format,
          impressions: a.impressions,
          clicks: a.clicks,
          ctr: a.impressions > 0 ? Number(((a.clicks / a.impressions) * 100).toFixed(2)) : 0,
        })),
    });
  });

  // =========================================================================
  // PROTECTED MOVIX ADM — SECURE FILE UPLOAD & MEDIA LIBRARY
  // =========================================================================
  router.post(
    '/api/adm/upload',
    requireAdmin,
    express.raw({ type: '*/*', limit: '52mb' }),
    (req, res) => {
      const folder = sanitizeFolder(String(req.query.folder || 'ads-images'));
      const allowedParam = String(req.query.kind || 'both');
      const allowedKinds: Array<'image' | 'video'> =
        allowedParam === 'image'
          ? ['image']
          : allowedParam === 'video'
            ? ['video']
            : ['image', 'video'];

      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!buf.length) {
        res.status(400).json({ error: 'Ficheiro vazio ou inválido.' });
        return;
      }

      const saved = saveUploadedBuffer({ buffer: buf, folder, allowedKinds });
      if (!saved.ok) {
        res.status(400).json({ error: saved.error });
        return;
      }

      audit(
        req,
        'Upload de ficheiro',
        'media',
        saved.filename || '',
        `Carregado em ${saved.folder} (${Math.round((saved.sizeBytes || 0) / 1024)} KB)`
      );
      res.json(saved);
    }
  );

  router.get('/api/adm/media', requireAdmin, (_req, res) => {
    const files = listAllMediaFiles();
    const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
    res.json({ files, totalBytes });
  });

  router.delete('/api/adm/media/:folder/:filename', requireAdminPermission('backup'), (req, res) => {
    const ok = deleteMediaFile(req.params.folder, req.params.filename);
    if (!ok) {
      res.status(404).json({ error: 'Ficheiro não encontrado.' });
      return;
    }
    audit(req, 'Ficheiro removido', 'media', req.params.filename, `Pasta: ${req.params.folder}`);
    res.json({ ok: true });
  });

  router.post('/api/adm/media/cleanup', requireAdminPermission('backup'), (req, res) => {
    const store = getAdmStore();
    const baseStore = getStore();
    const serialized = JSON.stringify({ store, baseStore });
    const files = listAllMediaFiles();
    let removedCount = 0;
    let freedBytes = 0;
    for (const f of files) {
      if (!serialized.includes(f.url)) {
        if (deleteMediaFile(f.folder, f.filename)) {
          removedCount += 1;
          freedBytes += f.sizeBytes;
        }
      }
    }
    audit(
      req,
      'Limpeza de ficheiros não utilizados',
      'media',
      'cleanup',
      `${removedCount} ficheiros removidos (${Math.round(freedBytes / 1024)} KB libertados)`
    );
    res.json({ ok: true, removedCount, freedBytes });
  });

  // =========================================================================
  // PROTECTED MOVIX ADM — MOVIES CRUD & TMDB IMPORT
  // =========================================================================
  router.get('/api/adm/movies', requireAdminPermission('movies'), (_req, res) => {
    res.json({ movies: getAdmStore().movies });
  });

  router.post('/api/adm/movies/import-tmdb', requireAdminPermission('movies'), async (req, res) => {
    const tmdbId = Number(req.body?.tmdbId);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      res.status(400).json({ error: 'ID do TMDB inválido.' });
      return;
    }
    try {
      const det = await getMovieDetails(tmdbId);
      const store = getAdmStore();
      const existing = store.movies.find((m) => m.tmdbId === tmdbId);
      if (existing) {
        res.json({ movie: existing, alreadyExists: true });
        return;
      }
      const now = new Date().toISOString();
      const trailerKey = det.trailers?.[0]?.key || '';
      const defaultSrv = store.servers.find((s) => s.active && s.isDefault);
      const autoServers: PlaybackServerLink[] = defaultSrv
        ? [
            {
              id: `srv_${Date.now().toString(36)}`,
              name: defaultSrv.name,
              url: `${defaultSrv.baseUrl.replace(/\/+$/, '')}/embed/movie/${tmdbId}`,
              language: 'dublado',
              quality: 'HD 1080p',
              type: defaultSrv.kind === 'embed' ? 'embed' : 'stream',
              active: true,
              order: 1,
            },
          ]
        : [];

      const created: ManagedMovie = {
        id: `mov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        tmdbId,
        title: det.title,
        originalTitle: det.originalTitle,
        overview: det.overview,
        posterUrl: det.posterUrl || '',
        backdropUrl: det.backdropUrl || '',
        trailerUrl: trailerKey ? `https://www.youtube.com/watch?v=${trailerKey}` : '',
        releaseDate: det.releaseDate || '',
        year: det.year || '',
        runtime: det.runtime || 0,
        language: 'pt-BR',
        certification: det.certification || '14',
        rating: det.rating || 0,
        categories: ['Filmes'],
        genres: det.genres.map((g) => g.name),
        servers: autoServers,
        featured: false,
        recommended: true,
        published: true,
        views: 0,
        createdAt: now,
        updatedAt: now,
      };
      store.movies.unshift(created);
      saveAdmStore();
      audit(req, 'Filme importado do TMDB', 'movie', created.id, `${created.title} (TMDB #${tmdbId})`);
      res.json({ movie: created, alreadyExists: false });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Erro ao importar do TMDB.' });
    }
  });

  router.post('/api/adm/movies', requireAdminPermission('movies'), (req, res) => {
    const body = req.body || {};
    const title = String(body.title || '').trim().slice(0, 160);
    if (!title) {
      res.status(400).json({ error: 'O título do filme é obrigatório.' });
      return;
    }
    const now = new Date().toISOString();
    const releaseDate = String(body.releaseDate || '').slice(0, 20);
    const created: ManagedMovie = {
      id: `mov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      tmdbId: Number.isInteger(Number(body.tmdbId)) && Number(body.tmdbId) > 0 ? Number(body.tmdbId) : null,
      title,
      originalTitle: String(body.originalTitle || title).slice(0, 160),
      overview: String(body.overview || '').slice(0, 3000),
      posterUrl: safeUrl(body.posterUrl, true),
      backdropUrl: safeUrl(body.backdropUrl, true),
      trailerUrl: safeUrl(body.trailerUrl, false),
      releaseDate,
      year: String(body.year || releaseDate.slice(0, 4) || '').slice(0, 10),
      runtime: Math.max(0, Number(body.runtime || 0)),
      language: String(body.language || 'pt-BR').slice(0, 30),
      certification: String(body.certification || 'L').slice(0, 16),
      rating: Math.max(0, Math.min(10, Number(body.rating || 0))),
      categories: Array.isArray(body.categories) ? body.categories.map(String).slice(0, 12) : [],
      genres: Array.isArray(body.genres) ? body.genres.map(String).slice(0, 12) : [],
      servers: sanitizeServers(body.servers),
      featured: Boolean(body.featured),
      recommended: Boolean(body.recommended),
      published: body.published !== false,
      views: 0,
      createdAt: now,
      updatedAt: now,
    };
    const store = getAdmStore();
    store.movies.unshift(created);
    saveAdmStore();
    audit(req, 'Filme adicionado', 'movie', created.id, created.title);
    res.json({ movie: created });
  });

  router.put('/api/adm/movies/:id', requireAdminPermission('movies'), (req, res) => {
    const store = getAdmStore();
    const idx = store.movies.findIndex((m) => m.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'Filme não encontrado.' });
      return;
    }
    const prev = store.movies[idx];
    const body = req.body || {};
    const releaseDate = body.releaseDate !== undefined ? String(body.releaseDate).slice(0, 20) : prev.releaseDate;
    const updated: ManagedMovie = {
      ...prev,
      tmdbId:
        body.tmdbId !== undefined
          ? Number.isInteger(Number(body.tmdbId)) && Number(body.tmdbId) > 0
            ? Number(body.tmdbId)
            : null
          : prev.tmdbId,
      title: body.title !== undefined ? String(body.title).trim().slice(0, 160) || prev.title : prev.title,
      originalTitle: body.originalTitle !== undefined ? String(body.originalTitle).slice(0, 160) : prev.originalTitle,
      overview: body.overview !== undefined ? String(body.overview).slice(0, 3000) : prev.overview,
      posterUrl: body.posterUrl !== undefined ? safeUrl(body.posterUrl, true) : prev.posterUrl,
      backdropUrl: body.backdropUrl !== undefined ? safeUrl(body.backdropUrl, true) : prev.backdropUrl,
      trailerUrl: body.trailerUrl !== undefined ? safeUrl(body.trailerUrl, false) : prev.trailerUrl,
      releaseDate,
      year: body.year !== undefined ? String(body.year).slice(0, 10) : releaseDate.slice(0, 4) || prev.year,
      runtime: body.runtime !== undefined ? Math.max(0, Number(body.runtime || 0)) : prev.runtime,
      language: body.language !== undefined ? String(body.language).slice(0, 30) : prev.language,
      certification: body.certification !== undefined ? String(body.certification).slice(0, 16) : prev.certification,
      rating: body.rating !== undefined ? Math.max(0, Math.min(10, Number(body.rating || 0))) : prev.rating,
      categories: Array.isArray(body.categories) ? body.categories.map(String).slice(0, 12) : prev.categories,
      genres: Array.isArray(body.genres) ? body.genres.map(String).slice(0, 12) : prev.genres,
      servers: body.servers !== undefined ? sanitizeServers(body.servers) : prev.servers,
      featured: body.featured !== undefined ? Boolean(body.featured) : prev.featured,
      recommended: body.recommended !== undefined ? Boolean(body.recommended) : prev.recommended,
      published: body.published !== undefined ? Boolean(body.published) : prev.published,
      updatedAt: new Date().toISOString(),
    };
    store.movies[idx] = updated;
    saveAdmStore();
    audit(req, 'Filme atualizado', 'movie', updated.id, updated.title);
    res.json({ movie: updated });
  });

  router.delete('/api/adm/movies/:id', requireAdminPermission('movies'), (req, res) => {
    const store = getAdmStore();
    const target = store.movies.find((m) => m.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Filme não encontrado.' });
      return;
    }
    store.movies = store.movies.filter((m) => m.id !== req.params.id);
    saveAdmStore();
    audit(req, 'Filme eliminado', 'movie', target.id, target.title);
    res.json({ ok: true });
  });

  // =========================================================================
  // PROTECTED MOVIX ADM — SERIES, SEASONS & EPISODES CRUD + TMDB IMPORT
  // =========================================================================
  router.get('/api/adm/series', requireAdminPermission('series'), (_req, res) => {
    res.json({ series: getAdmStore().series });
  });

  router.post('/api/adm/series/import-tmdb', requireAdminPermission('series'), async (req, res) => {
    const tmdbId = Number(req.body?.tmdbId);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      res.status(400).json({ error: 'ID TMDB da série inválido.' });
      return;
    }
    try {
      const det = await getSeriesDetails(tmdbId);
      const store = getAdmStore();
      const existing = store.series.find((s) => s.tmdbId === tmdbId);
      if (existing) {
        res.json({ series: existing, alreadyExists: true });
        return;
      }

      const now = new Date().toISOString();
      const trailerKey = det.trailers?.[0]?.key || '';
      const defaultSrv = store.servers.find((s) => s.active && s.isDefault);

      // Import up to first 3 seasons with episodes automatically for immediate readiness
      const seasons: ManagedSeason[] = [];
      for (const s of det.seasons.slice(0, 6)) {
        let eps: ManagedEpisode[] = [];
        if (s.seasonNumber <= 2) {
          try {
            const seasonDet = await getSeriesSeason(tmdbId, s.seasonNumber);
            eps = seasonDet.episodes.map((ep) => ({
              id: `ep_${Date.now().toString(36)}_${s.seasonNumber}_${ep.episodeNumber}`,
              episodeNumber: ep.episodeNumber,
              title: ep.name || `Episódio ${ep.episodeNumber}`,
              overview: ep.overview || '',
              stillUrl: ep.stillUrl || '',
              duration: ep.runtime || det.episodeRuntime || 45,
              airDate: ep.airDate || '',
              servers: defaultSrv
                ? [
                    {
                      id: `esrv_${s.seasonNumber}_${ep.episodeNumber}`,
                      name: defaultSrv.name,
                      url: `${defaultSrv.baseUrl.replace(/\/+$/, '')}/embed/tv/${tmdbId}/${s.seasonNumber}/${ep.episodeNumber}`,
                      language: 'dublado',
                      quality: 'HD 1080p',
                      type: defaultSrv.kind === 'embed' ? 'embed' : 'stream',
                      active: true,
                      order: 1,
                    },
                  ]
                : [],
              published: true,
              views: 0,
              createdAt: now,
              updatedAt: now,
            }));
          } catch {
            eps = [];
          }
        }
        seasons.push({
          id: `sea_${Date.now().toString(36)}_${s.seasonNumber}`,
          seasonNumber: s.seasonNumber,
          title: s.name || `Temporada ${s.seasonNumber}`,
          overview: s.overview || '',
          posterUrl: s.posterUrl || det.posterUrl || '',
          published: true,
          episodes: eps,
          createdAt: now,
          updatedAt: now,
        });
      }

      const created: ManagedSeries = {
        id: `ser_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        tmdbId,
        title: det.title,
        originalTitle: det.originalTitle,
        overview: det.overview,
        posterUrl: det.posterUrl || '',
        backdropUrl: det.backdropUrl || '',
        trailerUrl: trailerKey ? `https://www.youtube.com/watch?v=${trailerKey}` : '',
        releaseDate: det.releaseDate || '',
        year: det.year || '',
        language: 'pt-BR',
        certification: det.certification || '14',
        rating: det.rating || 0,
        categories: ['Séries'],
        genres: det.genres.map((g) => g.name),
        featured: false,
        recommended: true,
        published: true,
        views: 0,
        seasons,
        createdAt: now,
        updatedAt: now,
      };
      store.series.unshift(created);
      saveAdmStore();
      audit(req, 'Série importada do TMDB', 'series', created.id, `${created.title} (${seasons.length} temporadas)`);
      res.json({ series: created, alreadyExists: false });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Erro ao importar série do TMDB.' });
    }
  });

  router.post('/api/adm/series', requireAdminPermission('series'), (req, res) => {
    const body = req.body || {};
    const title = String(body.title || '').trim().slice(0, 160);
    if (!title) {
      res.status(400).json({ error: 'O título da série é obrigatório.' });
      return;
    }
    const now = new Date().toISOString();
    const releaseDate = String(body.releaseDate || '').slice(0, 20);
    const created: ManagedSeries = {
      id: `ser_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      tmdbId: Number.isInteger(Number(body.tmdbId)) && Number(body.tmdbId) > 0 ? Number(body.tmdbId) : null,
      title,
      originalTitle: String(body.originalTitle || title).slice(0, 160),
      overview: String(body.overview || '').slice(0, 3000),
      posterUrl: safeUrl(body.posterUrl, true),
      backdropUrl: safeUrl(body.backdropUrl, true),
      trailerUrl: safeUrl(body.trailerUrl, false),
      releaseDate,
      year: String(body.year || releaseDate.slice(0, 4) || '').slice(0, 10),
      language: String(body.language || 'pt-BR').slice(0, 30),
      certification: String(body.certification || '14').slice(0, 16),
      rating: Math.max(0, Math.min(10, Number(body.rating || 0))),
      categories: Array.isArray(body.categories) ? body.categories.map(String).slice(0, 12) : [],
      genres: Array.isArray(body.genres) ? body.genres.map(String).slice(0, 12) : [],
      featured: Boolean(body.featured),
      recommended: Boolean(body.recommended),
      published: body.published !== false,
      views: 0,
      seasons: [],
      createdAt: now,
      updatedAt: now,
    };
    const store = getAdmStore();
    store.series.unshift(created);
    saveAdmStore();
    audit(req, 'Série adicionada', 'series', created.id, created.title);
    res.json({ series: created });
  });

  router.put('/api/adm/series/:id', requireAdminPermission('series'), (req, res) => {
    const store = getAdmStore();
    const idx = store.series.findIndex((s) => s.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'Série não encontrada.' });
      return;
    }
    const prev = store.series[idx];
    const body = req.body || {};
    const updated: ManagedSeries = {
      ...prev,
      title: body.title !== undefined ? String(body.title).trim().slice(0, 160) || prev.title : prev.title,
      originalTitle: body.originalTitle !== undefined ? String(body.originalTitle).slice(0, 160) : prev.originalTitle,
      overview: body.overview !== undefined ? String(body.overview).slice(0, 3000) : prev.overview,
      posterUrl: body.posterUrl !== undefined ? safeUrl(body.posterUrl, true) : prev.posterUrl,
      backdropUrl: body.backdropUrl !== undefined ? safeUrl(body.backdropUrl, true) : prev.backdropUrl,
      trailerUrl: body.trailerUrl !== undefined ? safeUrl(body.trailerUrl, false) : prev.trailerUrl,
      releaseDate: body.releaseDate !== undefined ? String(body.releaseDate).slice(0, 20) : prev.releaseDate,
      year: body.year !== undefined ? String(body.year).slice(0, 10) : prev.year,
      language: body.language !== undefined ? String(body.language).slice(0, 30) : prev.language,
      certification: body.certification !== undefined ? String(body.certification).slice(0, 16) : prev.certification,
      rating: body.rating !== undefined ? Math.max(0, Math.min(10, Number(body.rating || 0))) : prev.rating,
      categories: Array.isArray(body.categories) ? body.categories.map(String).slice(0, 12) : prev.categories,
      genres: Array.isArray(body.genres) ? body.genres.map(String).slice(0, 12) : prev.genres,
      featured: body.featured !== undefined ? Boolean(body.featured) : prev.featured,
      recommended: body.recommended !== undefined ? Boolean(body.recommended) : prev.recommended,
      published: body.published !== undefined ? Boolean(body.published) : prev.published,
      updatedAt: new Date().toISOString(),
    };
    store.series[idx] = updated;
    saveAdmStore();
    audit(req, 'Série atualizada', 'series', updated.id, updated.title);
    res.json({ series: updated });
  });

  router.delete('/api/adm/series/:id', requireAdminPermission('series'), (req, res) => {
    const store = getAdmStore();
    const target = store.series.find((s) => s.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Série não encontrada.' });
      return;
    }
    store.series = store.series.filter((s) => s.id !== req.params.id);
    saveAdmStore();
    audit(req, 'Série eliminada', 'series', target.id, target.title);
    res.json({ ok: true });
  });

  // Seasons CRUD
  router.post('/api/adm/series/:seriesId/seasons', requireAdminPermission('seasons'), (req, res) => {
    const store = getAdmStore();
    const series = store.series.find((s) => s.id === req.params.seriesId);
    if (!series) {
      res.status(404).json({ error: 'Série não encontrada.' });
      return;
    }
    const seasonNumber = Math.max(1, Number(req.body?.seasonNumber || series.seasons.length + 1));
    const now = new Date().toISOString();
    const season: ManagedSeason = {
      id: `sea_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      seasonNumber,
      title: String(req.body?.title || `Temporada ${seasonNumber}`).slice(0, 120),
      overview: String(req.body?.overview || '').slice(0, 1500),
      posterUrl: safeUrl(req.body?.posterUrl, true) || series.posterUrl,
      published: req.body?.published !== false,
      episodes: [],
      createdAt: now,
      updatedAt: now,
    };
    series.seasons.push(season);
    series.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
    series.updatedAt = now;
    saveAdmStore();
    audit(req, 'Temporada criada', 'season', season.id, `${series.title} · ${season.title}`);
    res.json({ series, season });
  });

  router.put('/api/adm/series/:seriesId/seasons/:seasonId', requireAdminPermission('seasons'), (req, res) => {
    const store = getAdmStore();
    const series = store.series.find((s) => s.id === req.params.seriesId);
    const season = series?.seasons.find((s) => s.id === req.params.seasonId);
    if (!series || !season) {
      res.status(404).json({ error: 'Temporada não encontrada.' });
      return;
    }
    if (req.body?.seasonNumber !== undefined) season.seasonNumber = Math.max(1, Number(req.body.seasonNumber));
    if (req.body?.title !== undefined) season.title = String(req.body.title).slice(0, 120);
    if (req.body?.overview !== undefined) season.overview = String(req.body.overview).slice(0, 1500);
    if (req.body?.posterUrl !== undefined) season.posterUrl = safeUrl(req.body.posterUrl, true);
    if (req.body?.published !== undefined) season.published = Boolean(req.body.published);
    season.updatedAt = new Date().toISOString();
    series.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
    saveAdmStore();
    audit(req, 'Temporada atualizada', 'season', season.id, `${series.title} · ${season.title}`);
    res.json({ series, season });
  });

  router.delete('/api/adm/series/:seriesId/seasons/:seasonId', requireAdminPermission('seasons'), (req, res) => {
    const store = getAdmStore();
    const series = store.series.find((s) => s.id === req.params.seriesId);
    if (!series) {
      res.status(404).json({ error: 'Série não encontrada.' });
      return;
    }
    const target = series.seasons.find((s) => s.id === req.params.seasonId);
    if (!target) {
      res.status(404).json({ error: 'Temporada não encontrada.' });
      return;
    }
    series.seasons = series.seasons.filter((s) => s.id !== req.params.seasonId);
    saveAdmStore();
    audit(req, 'Temporada eliminada', 'season', target.id, `${series.title} · ${target.title}`);
    res.json({ series });
  });

  // Episodes CRUD
  router.post(
    '/api/adm/series/:seriesId/seasons/:seasonId/episodes',
    requireAdminPermission('episodes'),
    (req, res) => {
      const store = getAdmStore();
      const series = store.series.find((s) => s.id === req.params.seriesId);
      const season = series?.seasons.find((s) => s.id === req.params.seasonId);
      if (!series || !season) {
        res.status(404).json({ error: 'Temporada não encontrada.' });
        return;
      }
      const epNum = Math.max(1, Number(req.body?.episodeNumber || season.episodes.length + 1));
      const now = new Date().toISOString();
      const ep: ManagedEpisode = {
        id: `ep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        episodeNumber: epNum,
        title: String(req.body?.title || `Episódio ${epNum}`).slice(0, 140),
        overview: String(req.body?.overview || '').slice(0, 1500),
        stillUrl: safeUrl(req.body?.stillUrl, true),
        duration: Math.max(0, Number(req.body?.duration || 45)),
        airDate: String(req.body?.airDate || '').slice(0, 20),
        servers: sanitizeServers(req.body?.servers),
        published: req.body?.published !== false,
        views: 0,
        createdAt: now,
        updatedAt: now,
      };
      season.episodes.push(ep);
      season.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
      saveAdmStore();
      audit(req, 'Episódio adicionado', 'episode', ep.id, `${series.title} T${season.seasonNumber}E${ep.episodeNumber}`);
      res.json({ series, episode: ep });
    }
  );

  router.put(
    '/api/adm/series/:seriesId/seasons/:seasonId/episodes/:epId',
    requireAdminPermission('episodes'),
    (req, res) => {
      const store = getAdmStore();
      const series = store.series.find((s) => s.id === req.params.seriesId);
      const season = series?.seasons.find((s) => s.id === req.params.seasonId);
      const ep = season?.episodes.find((e) => e.id === req.params.epId);
      if (!series || !season || !ep) {
        res.status(404).json({ error: 'Episódio não encontrado.' });
        return;
      }
      if (req.body?.episodeNumber !== undefined) ep.episodeNumber = Math.max(1, Number(req.body.episodeNumber));
      if (req.body?.title !== undefined) ep.title = String(req.body.title).slice(0, 140);
      if (req.body?.overview !== undefined) ep.overview = String(req.body.overview).slice(0, 1500);
      if (req.body?.stillUrl !== undefined) ep.stillUrl = safeUrl(req.body.stillUrl, true);
      if (req.body?.duration !== undefined) ep.duration = Math.max(0, Number(req.body.duration || 0));
      if (req.body?.airDate !== undefined) ep.airDate = String(req.body.airDate).slice(0, 20);
      if (req.body?.servers !== undefined) ep.servers = sanitizeServers(req.body.servers);
      if (req.body?.published !== undefined) ep.published = Boolean(req.body.published);
      ep.updatedAt = new Date().toISOString();
      season.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
      saveAdmStore();
      audit(req, 'Episódio atualizado', 'episode', ep.id, `${series.title} T${season.seasonNumber}E${ep.episodeNumber}`);
      res.json({ series, episode: ep });
    }
  );

  router.delete(
    '/api/adm/series/:seriesId/seasons/:seasonId/episodes/:epId',
    requireAdminPermission('episodes'),
    (req, res) => {
      const store = getAdmStore();
      const series = store.series.find((s) => s.id === req.params.seriesId);
      const season = series?.seasons.find((s) => s.id === req.params.seasonId);
      const ep = season?.episodes.find((e) => e.id === req.params.epId);
      if (!series || !season || !ep) {
        res.status(404).json({ error: 'Episódio não encontrado.' });
        return;
      }
      season.episodes = season.episodes.filter((e) => e.id !== req.params.epId);
      saveAdmStore();
      audit(req, 'Episódio eliminado', 'episode', ep.id, `${series.title} T${season.seasonNumber}E${ep.episodeNumber}`);
      res.json({ series });
    }
  );

  // =========================================================================
  // PROTECTED MOVIX ADS — CAMPAIGNS CRUD, PACING CONTROLS & ANALYTICS
  // =========================================================================
  router.get('/api/adm/ads-pacing', requireAdminPermission('ads'), (_req, res) => {
    const store = getAdmStore();
    const pacing: AdPacingConfig = {
      ...DEFAULT_AD_PACING,
      ...(store.siteConfig.adPacing || {}),
    };
    res.json({
      pacing,
      adsGlobalEnabled: Boolean(store.siteConfig.adsGlobalEnabled),
    });
  });

  router.put('/api/adm/ads-pacing', requireAdminPermission('ads'), (req, res) => {
    const store = getAdmStore();
    const b = req.body || {};
    const prev: AdPacingConfig = {
      ...DEFAULT_AD_PACING,
      ...(store.siteConfig.adPacing || {}),
    };

    const clampMinutes = (val: unknown, fallback: number, min: number, max: number) => {
      if (val === undefined || val === null || val === '') return fallback;
      const n = Number(val);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(min, Math.min(max, Math.round(n)));
    };

    const nextPacing: AdPacingConfig = {
      dismissCooldownMinutes: clampMinutes(b.dismissCooldownMinutes, prev.dismissCooldownMinutes, 1, 1440),
      largeAdIntervalMinutes: clampMinutes(b.largeAdIntervalMinutes, prev.largeAdIntervalMinutes, 0, 1440),
      playerAdIntervalMinutes: clampMinutes(b.playerAdIntervalMinutes, prev.playerAdIntervalMinutes, 0, 1440),
      headerAdAlwaysVisible:
        b.headerAdAlwaysVisible !== undefined ? Boolean(b.headerAdAlwaysVisible) : prev.headerAdAlwaysVisible,
    };

    store.siteConfig.adPacing = nextPacing;
    if (b.adsGlobalEnabled !== undefined) {
      store.siteConfig.adsGlobalEnabled = Boolean(b.adsGlobalEnabled);
    }
    store.siteConfig.updatedAt = new Date().toISOString();
    saveAdmStore();

    audit(
      req,
      'Frequência de anúncios alterada',
      'adPacing',
      'global',
      `Fechar: ${nextPacing.dismissCooldownMinutes}min · Grandes: ${nextPacing.largeAdIntervalMinutes}min · Player: ${nextPacing.playerAdIntervalMinutes}min · Topo sempre ativo: ${nextPacing.headerAdAlwaysVisible ? 'Sim' : 'Não'}`
    );
    broadcastConfigSyncEvent();
    res.json({
      ok: true,
      pacing: nextPacing,
      adsGlobalEnabled: Boolean(store.siteConfig.adsGlobalEnabled),
    });
  });

  router.get('/api/adm/ads', requireAdminPermission('ads'), (_req, res) => {
    refreshAdStatuses();
    res.json({ ads: getAdmStore().ads });
  });

  function buildSanitizedAd(body: Record<string, unknown>, prev?: AdCampaign): AdCampaign {
    const now = new Date().toISOString();
    const validFormats: AdFormatType[] = [
      'banner_horizontal', 'banner_vertical', 'banner_square', 'image_ad', 'video_ad',
      'promo_video', 'cta_ad', 'external_redirect', 'in_content', 'pre_roll', 'mid_roll', 'post_roll',
    ];
    const validPlacements: AdPlacement[] = [
      'home', 'header', 'between_movies', 'movie_detail', 'series_detail', 'seasons_page',
      'episodes_page', 'before_player', 'during_playback', 'after_playback', 'sidebar',
      'footer', 'search_page', 'categories_page',
    ];
    const validStatuses: AdStatus[] = ['active', 'paused', 'scheduled', 'expired', 'draft'];
    const validDevices: AdDeviceTarget[] = ['all', 'desktop', 'mobile', 'tablet'];

    const format = validFormats.includes(body.format as AdFormatType)
      ? (body.format as AdFormatType)
      : prev?.format || 'banner_horizontal';
    const mediaKind: 'image' | 'video' =
      body.mediaKind === 'video' || ['video_ad', 'promo_video', 'pre_roll', 'mid_roll', 'post_roll'].includes(format)
        ? 'video'
        : 'image';
    const placements = Array.isArray(body.placements)
      ? (body.placements.filter((p) => validPlacements.includes(p as AdPlacement)) as AdPlacement[])
      : prev?.placements || ['home'];
    const devices = Array.isArray(body.devices)
      ? (body.devices.filter((d) => validDevices.includes(d as AdDeviceTarget)) as AdDeviceTarget[])
      : prev?.devices || ['all'];
    const status = validStatuses.includes(body.status as AdStatus)
      ? (body.status as AdStatus)
      : prev?.status || 'draft';

    const requestedId =
      typeof body.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(body.id.trim())
        ? body.id.trim()
        : '';

    return {
      id: prev?.id || requestedId || `ad_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: String(body.name ?? prev?.name ?? 'Nova Campanha').trim().slice(0, 120),
      title: String(body.title ?? prev?.title ?? '').trim().slice(0, 140),
      description: String(body.description ?? prev?.description ?? '').trim().slice(0, 500),
      format,
      mediaKind,
      imageUrl: body.imageUrl !== undefined ? safeUrl(body.imageUrl, true) : prev?.imageUrl || '',
      videoUrl: body.videoUrl !== undefined ? safeUrl(body.videoUrl, true) : prev?.videoUrl || '',
      destinationUrl:
        body.destinationUrl !== undefined
          ? safeDestinationUrl(body.destinationUrl)
          : prev?.destinationUrl || '',
      ctaText: String(body.ctaText ?? prev?.ctaText ?? 'Saiba mais').trim().slice(0, 40),
      translations: prev?.translations ? { ...prev.translations } : undefined,
      startDate: String(body.startDate ?? prev?.startDate ?? '').slice(0, 30),
      endDate: String(body.endDate ?? prev?.endDate ?? '').slice(0, 30),
      status,
      priority: Math.max(1, Math.min(100, Number(body.priority ?? prev?.priority ?? 10))),
      placements: placements.length > 0 ? placements : ['home'],
      frequencyPerSession: Math.max(1, Math.min(50, Number(body.frequencyPerSession ?? prev?.frequencyPerSession ?? 3))),
      maxImpressions:
        body.maxImpressions === null || body.maxImpressions === ''
          ? null
          : Number.isFinite(Number(body.maxImpressions)) && Number(body.maxImpressions) > 0
            ? Math.floor(Number(body.maxImpressions))
            : prev?.maxImpressions ?? null,
      targetAudience: String(body.targetAudience ?? prev?.targetAudience ?? 'Todos os visitantes').slice(0, 100),
      countries: Array.isArray(body.countries)
        ? body.countries.map((c) => String(c).toUpperCase().slice(0, 5)).filter(Boolean).slice(0, 30)
        : prev?.countries || [],
      devices: devices.length > 0 ? devices : ['all'],
      autoplay: body.autoplay !== undefined ? Boolean(body.autoplay) : prev?.autoplay ?? true,
      startMuted: body.startMuted !== undefined ? Boolean(body.startMuted) : prev?.startMuted ?? false,
      skippable: body.skippable !== undefined ? Boolean(body.skippable) : prev?.skippable ?? true,
      skipAfterSeconds: Math.max(3, Math.min(30, Number(body.skipAfterSeconds ?? prev?.skipAfterSeconds ?? 5))),
      durationSeconds: Math.max(5, Math.min(120, Number(body.durationSeconds ?? prev?.durationSeconds ?? 15))),
      impressions: prev?.impressions || 0,
      clicks: prev?.clicks || 0,
      videoViews: prev?.videoViews || 0,
      videoCompletes: prev?.videoCompletes || 0,
      videoPartials: prev?.videoPartials || 0,
      totalWatchSeconds: prev?.totalWatchSeconds || 0,
      byDevice: prev?.byDevice || {
        desktop: { impressions: 0, clicks: 0 },
        mobile: { impressions: 0, clicks: 0 },
        tablet: { impressions: 0, clicks: 0 },
      },
      dailyStats: prev?.dailyStats || [],
      createdAt: prev?.createdAt || now,
      updatedAt: now,
    };
  }

  function resolveRequestHttpsOrigin(req: Request): string {
    const appUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
    if (appUrl.startsWith('https://')) return appUrl;
    const proto = String(req.get('x-forwarded-proto') || req.protocol || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const host = String(req.get('x-forwarded-host') || req.get('host') || '')
      .split(',')[0]
      .trim();
    if (proto === 'https' && host && !isPrivateOrBlockedHost(host.split(':')[0])) {
      return `https://${host}`;
    }
    return '';
  }

  async function notifyUsersForPublishedAd(ad: AdCampaign, req: Request) {
    try {
      const origin = resolveRequestHttpsOrigin(req);
      const rawImage = (ad.imageUrl || '').trim();
      const imageUrl =
        rawImage.startsWith('/api/media/') && origin ? `${origin}${rawImage}` : rawImage;
      const notifTitle = (ad.title || ad.name || 'Novidade no MOVIX').trim().slice(0, 120);
      const notifBody =
        (ad.description || '').trim().slice(0, 320) ||
        (ad.ctaText
          ? `${ad.ctaText} — Confira esta novidade em destaque no MOVIX!`
          : 'Confira a nova campanha em destaque agora no MOVIX!');
      const targetUrl =
        ad.destinationUrl && ad.destinationUrl.startsWith('https://')
          ? ad.destinationUrl
          : ad.placements.includes('categories_page')
            ? '#/filmes'
            : '#/';

      const record = await sendOrScheduleAdminCampaign({
        title: notifTitle,
        body: notifBody,
        image_url: imageUrl,
        target_url: targetUrl,
        category: 'recommendations',
      });

      ad.notifiedAt = new Date().toISOString();
      saveAdmStore();

      audit(
        req,
        'Notificação de anúncio enviada',
        'ad',
        ad.id,
        `${notifTitle} · ${record.success_count}/${record.targeted_count} dispositivos`
      );

      return {
        sent: true,
        campaignId: record.id,
        targetedCount: record.targeted_count,
        successCount: record.success_count,
        note: record.note,
      };
    } catch (err) {
      return {
        sent: false,
        targetedCount: 0,
        successCount: 0,
        note: err instanceof Error ? err.message : 'Falha ao enviar notificação automática.',
      };
    }
  }

  router.post('/api/adm/ads', requireAdminPermission('ads'), async (req, res) => {
    const campaign = buildSanitizedAd(req.body || {});
    if (!campaign.name) {
      res.status(400).json({ error: 'Nome da campanha é obrigatório.' });
      return;
    }
    const store = getAdmStore();
    store.ads.unshift(campaign);
    refreshAdStatuses();
    saveAdmStore();
    prewarmAdTranslations(campaign);
    audit(req, campaign.status === 'active' ? 'Anúncio publicado' : 'Campanha criada', 'ad', campaign.id, campaign.name);

    const shouldNotify = campaign.status === 'active' && req.body?.notifyUsers !== false;
    const notification = shouldNotify ? await notifyUsersForPublishedAd(campaign, req) : null;
    broadcastConfigSyncEvent();
    res.json({ ad: campaign, notification });
  });

  router.put('/api/adm/ads/:id', requireAdminPermission('ads'), async (req, res) => {
    const store = getAdmStore();
    const idx = store.ads.findIndex((a) => a.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'Campanha não encontrada.' });
      return;
    }
    const prev = store.ads[idx];
    const updated = buildSanitizedAd(req.body || {}, prev);
    updated.notifiedAt = prev.notifiedAt || null;
    store.ads[idx] = updated;
    refreshAdStatuses();
    saveAdmStore();
    prewarmAdTranslations(updated);
    const actionLabel =
      prev.status !== updated.status
        ? updated.status === 'paused'
          ? 'Campanha pausada'
          : updated.status === 'active'
            ? 'Anúncio publicado'
            : `Estado alterado (${updated.status})`
        : 'Campanha atualizada';
    audit(req, actionLabel, 'ad', updated.id, updated.name);

    const becameActive = prev.status !== 'active' && updated.status === 'active';
    const explicitRepublishNotify = updated.status === 'active' && req.body?.notifyUsers === true;
    const shouldNotify =
      updated.status === 'active' &&
      req.body?.notifyUsers !== false &&
      (becameActive || explicitRepublishNotify);

    const notification = shouldNotify ? await notifyUsersForPublishedAd(updated, req) : null;
    broadcastConfigSyncEvent();
    res.json({ ad: updated, notification });
  });

  router.delete('/api/adm/ads/:id', requireAdminPermission('ads'), (req, res) => {
    const store = getAdmStore();
    const target = store.ads.find((a) => a.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Campanha não encontrada.' });
      return;
    }
    store.ads = store.ads.filter((a) => a.id !== req.params.id);
    saveAdmStore();
    audit(req, 'Campanha eliminada', 'ad', target.id, target.name);
    broadcastConfigSyncEvent();
    res.json({ ok: true });
  });

  router.get('/api/adm/ads/stats', requireAdminPermission('ad_stats'), (req, res) => {
    refreshAdStatuses();
    const store = getAdmStore();
    const period = String(req.query.period || '30d');
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const minDate = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);

    const byDate = new Map<string, { date: string; impressions: number; clicks: number; videoViews: number }>();
    const deviceTotals = {
      desktop: { impressions: 0, clicks: 0 },
      mobile: { impressions: 0, clicks: 0 },
      tablet: { impressions: 0, clicks: 0 },
    };

    let totalImpressions = 0;
    let totalClicks = 0;
    let totalVideoViews = 0;
    let totalVideoCompletes = 0;
    let totalVideoPartials = 0;
    let totalWatchSeconds = 0;

    for (const ad of store.ads) {
      totalImpressions += ad.impressions;
      totalClicks += ad.clicks;
      totalVideoViews += ad.videoViews;
      totalVideoCompletes += ad.videoCompletes;
      totalVideoPartials += ad.videoPartials;
      totalWatchSeconds += ad.totalWatchSeconds;

      deviceTotals.desktop.impressions += ad.byDevice.desktop.impressions;
      deviceTotals.desktop.clicks += ad.byDevice.desktop.clicks;
      deviceTotals.mobile.impressions += ad.byDevice.mobile.impressions;
      deviceTotals.mobile.clicks += ad.byDevice.mobile.clicks;
      deviceTotals.tablet.impressions += ad.byDevice.tablet.impressions;
      deviceTotals.tablet.clicks += ad.byDevice.tablet.clicks;

      for (const d of ad.dailyStats) {
        if (d.date < minDate) continue;
        const cur = byDate.get(d.date) || { date: d.date, impressions: 0, clicks: 0, videoViews: 0 };
        cur.impressions += d.impressions;
        cur.clicks += d.clicks;
        cur.videoViews += d.videoViews;
        byDate.set(d.date, cur);
      }
    }

    const timeline = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    const campaigns = store.ads.map((ad) => {
      const ctr = ad.impressions > 0 ? Number(((ad.clicks / ad.impressions) * 100).toFixed(2)) : 0;
      const denom = ad.videoViews || ad.videoCompletes + ad.videoPartials || 0;
      const avgWatch = denom > 0 ? Number((ad.totalWatchSeconds / denom).toFixed(1)) : 0;
      return {
        id: ad.id,
        name: ad.name,
        format: ad.format,
        mediaKind: ad.mediaKind,
        status: ad.status,
        impressions: ad.impressions,
        clicks: ad.clicks,
        ctr,
        videoViews: ad.videoViews,
        videoCompletes: ad.videoCompletes,
        videoPartials: ad.videoPartials,
        avgWatchSeconds: avgWatch,
      };
    });

    const totalVideoPlays = totalVideoViews || totalVideoCompletes + totalVideoPartials;
    res.json({
      summary: {
        totalImpressions,
        totalClicks,
        ctr: totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0,
        totalVideoViews,
        totalVideoCompletes,
        totalVideoPartials,
        avgWatchSeconds: totalVideoPlays > 0 ? Number((totalWatchSeconds / totalVideoPlays).toFixed(1)) : 0,
        activeCampaigns: store.ads.filter((a) => a.status === 'active').length,
      },
      deviceTotals,
      timeline,
      campaigns: campaigns.sort((a, b) => b.impressions - a.impressions),
    });
  });

  // =========================================================================
  // PROTECTED MOVIX ADM — USERS MANAGEMENT (NEVER EXPOSES PASSWORDS)
  // =========================================================================
  router.get('/api/adm/users', requireAdminPermission('users'), (_req, res) => {
    const store = getAdmStore();
    res.json({ users: store.users });
  });

  router.patch('/api/adm/users/:uid', requireAdminPermission('users'), (req, res) => {
    const store = getAdmStore();
    const user = store.users.find((u) => u.uid === req.params.uid);
    if (!user) {
      res.status(404).json({ error: 'Utilizador não encontrado.' });
      return;
    }
    const prevStatus = user.status;
    if (req.body?.status === 'active' || req.body?.status === 'blocked') {
      user.status = req.body.status;
    }
    if (req.body?.role === 'user' || req.body?.role === 'vip' || req.body?.role === 'moderator') {
      user.role = req.body.role;
    }
    saveAdmStore();
    audit(
      req,
      prevStatus !== user.status
        ? user.status === 'blocked'
          ? 'Utilizador bloqueado'
          : 'Utilizador desbloqueado'
        : 'Permissão de utilizador atualizada',
      'user',
      user.uid,
      `${user.displayName} (${user.email})`
    );
    res.json({ user });
  });

  router.delete('/api/adm/users/:uid', requireAdminPermission('users'), (req, res) => {
    const store = getAdmStore();
    const target = store.users.find((u) => u.uid === req.params.uid);
    if (!target) {
      res.status(404).json({ error: 'Utilizador não encontrado.' });
      return;
    }
    store.users = store.users.filter((u) => u.uid !== req.params.uid);
    saveAdmStore();
    audit(req, 'Utilizador eliminado', 'user', target.uid, `${target.displayName} (${target.email})`);
    res.json({ ok: true });
  });

  // =========================================================================
  // PROTECTED MOVIX ADM — GENRES & PLAYBACK SERVERS
  // =========================================================================
  router.get('/api/adm/genres', requireAdminPermission('genres'), (_req, res) => {
    res.json({ genres: getAdmStore().genres });
  });

  router.put('/api/adm/genres', requireAdminPermission('genres'), (req, res) => {
    if (!Array.isArray(req.body?.genres)) {
      res.status(400).json({ error: 'Lista de géneros inválida.' });
      return;
    }
    const store = getAdmStore();
    store.genres = (req.body.genres as Partial<ManagedGenre>[]).map((g, idx) => {
      const name = String(g.name || `Género ${idx + 1}`).trim().slice(0, 60);
      const slug =
        String(g.slug || name)
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || `gen-${idx}`;
      return {
        id: String(g.id || `gen_${Date.now().toString(36)}_${idx}`),
        name,
        slug,
        mediaType: g.mediaType === 'movie' || g.mediaType === 'tv' ? g.mediaType : 'both',
        active: g.active !== false,
        order: Number.isFinite(g.order) ? Number(g.order) : idx + 1,
      };
    });
    saveAdmStore();
    audit(req, 'Géneros atualizados', 'genre', 'list', `${store.genres.length} géneros guardados`);
    res.json({ genres: store.genres });
  });

  router.get('/api/adm/servers', requireAdminPermission('servers'), (_req, res) => {
    res.json({ servers: getAdmStore().servers });
  });

  router.put('/api/adm/servers', requireAdminPermission('servers'), (req, res) => {
    if (!Array.isArray(req.body?.servers)) {
      res.status(400).json({ error: 'Lista de servidores inválida.' });
      return;
    }
    const store = getAdmStore();
    store.servers = (req.body.servers as Partial<GlobalPlaybackServer>[]).map((s, idx) => ({
      id: String(s.id || `srv_${Date.now().toString(36)}_${idx}`),
      name: String(s.name || `Servidor ${idx + 1}`).trim().slice(0, 80),
      baseUrl: safeUrl(s.baseUrl, false),
      kind: s.kind === 'stream' || s.kind === 'hls' ? s.kind : 'embed',
      active: s.active !== false,
      isDefault: Boolean(s.isDefault),
      order: Number.isFinite(s.order) ? Number(s.order) : idx + 1,
      lastTestedAt: s.lastTestedAt || null,
      lastStatus: s.lastStatus === 'online' || s.lastStatus === 'offline' ? s.lastStatus : 'unknown',
      lastLatencyMs: typeof s.lastLatencyMs === 'number' ? s.lastLatencyMs : null,
    }));
    saveAdmStore();
    audit(req, 'Servidores atualizados', 'server', 'list', `${store.servers.length} servidores configurados`);
    res.json({ servers: store.servers });
  });

  router.post('/api/adm/servers/:id/test', requireAdminPermission('servers'), async (req, res) => {
    const store = getAdmStore();
    const srv = store.servers.find((s) => s.id === req.params.id);
    const targetUrl = safeUrl(req.body?.url || srv?.baseUrl, false);
    if (!targetUrl) {
      res.status(400).json({ error: 'URL de servidor inválido.' });
      return;
    }
    const parsed = new URL(targetUrl);
    if (isPrivateOrBlockedHost(parsed.hostname)) {
      res.status(400).json({ error: 'Endereço interno ou privado bloqueado por segurança.' });
      return;
    }

    const start = Date.now();
    let online = false;
    let statusCode = 0;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(targetUrl, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      statusCode = resp.status;
      online = resp.status > 0 && resp.status < 500;
    } catch {
      online = false;
    }
    const latencyMs = Date.now() - start;
    if (srv) {
      srv.lastTestedAt = new Date().toISOString();
      srv.lastStatus = online ? 'online' : 'offline';
      srv.lastLatencyMs = latencyMs;
      saveAdmStore();
    }
    res.json({ ok: true, online, statusCode, latencyMs, server: srv || null });
  });

  // =========================================================================
  // PROTECTED MOVIX ADM — SITE IDENTITY & PAGES CONFIG
  // =========================================================================
  router.get('/api/adm/site-config', requireAdmin, (req, res) => {
    const session = req.adminSession;
    if (
      !session ||
      (session.adminRole !== 'super_admin' &&
        !session.permissions.includes('pages') &&
        !session.permissions.includes('settings'))
    ) {
      res.status(403).json({ error: 'Sem permissão para aceder às configurações do site.' });
      return;
    }
    res.json({ siteConfig: getAdmStore().siteConfig });
  });

  router.put('/api/adm/site-config', requireAdmin, async (req, res) => {
    const session = req.adminSession;
    if (
      !session ||
      (session.adminRole !== 'super_admin' &&
        !session.permissions.includes('pages') &&
        !session.permissions.includes('settings'))
    ) {
      res.status(403).json({ error: 'Sem permissão para alterar configurações do site.' });
      return;
    }

    const store = getAdmStore();
    const b = req.body || {};
    const prev = store.siteConfig;
    const wasMaintenance =
      typeof b.previousMaintenanceMode === 'boolean'
        ? b.previousMaintenanceMode
        : Boolean(prev.maintenanceMode);
    const primaryColor =
      typeof b.primaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.primaryColor.trim())
        ? b.primaryColor.trim()
        : prev.primaryColor;

    store.siteConfig = {
      platformName: typeof b.platformName === 'string' ? b.platformName.trim().slice(0, 60) || 'MOVIX' : prev.platformName,
      logoUrl: b.logoUrl !== undefined ? safeUrl(b.logoUrl, true) : prev.logoUrl,
      faviconUrl: b.faviconUrl !== undefined ? safeUrl(b.faviconUrl, true) : prev.faviconUrl,
      primaryColor,
      heroTagline: typeof b.heroTagline === 'string' ? b.heroTagline.slice(0, 200) : prev.heroTagline,
      aboutUs: typeof b.aboutUs === 'string' ? b.aboutUs.slice(0, 5000) : prev.aboutUs,
      privacyPolicy: typeof b.privacyPolicy === 'string' ? b.privacyPolicy.slice(0, 8000) : prev.privacyPolicy,
      termsOfUse: typeof b.termsOfUse === 'string' ? b.termsOfUse.slice(0, 8000) : prev.termsOfUse,
      contactEmail: typeof b.contactEmail === 'string' ? b.contactEmail.trim().slice(0, 120) : prev.contactEmail,
      contactPhone: typeof b.contactPhone === 'string' ? b.contactPhone.trim().slice(0, 40) : prev.contactPhone,
      socialInstagram: b.socialInstagram !== undefined ? safeUrl(b.socialInstagram, false) : prev.socialInstagram,
      socialYoutube: b.socialYoutube !== undefined ? safeUrl(b.socialYoutube, false) : prev.socialYoutube,
      socialTelegram: b.socialTelegram !== undefined ? safeUrl(b.socialTelegram, false) : prev.socialTelegram,
      socialTwitter: b.socialTwitter !== undefined ? safeUrl(b.socialTwitter, false) : prev.socialTwitter,
      seoTitle: typeof b.seoTitle === 'string' ? b.seoTitle.slice(0, 120) : prev.seoTitle,
      seoDescription: typeof b.seoDescription === 'string' ? b.seoDescription.slice(0, 320) : prev.seoDescription,
      seoKeywords: typeof b.seoKeywords === 'string' ? b.seoKeywords.slice(0, 300) : prev.seoKeywords,
      maintenanceMode: b.maintenanceMode !== undefined ? Boolean(b.maintenanceMode) : prev.maintenanceMode,
      adsGlobalEnabled: b.adsGlobalEnabled !== undefined ? Boolean(b.adsGlobalEnabled) : prev.adsGlobalEnabled,
      adPacing: {
        ...DEFAULT_AD_PACING,
        ...(prev.adPacing || {}),
        ...(b.adPacing && typeof b.adPacing === 'object'
          ? {
              dismissCooldownMinutes: Math.max(
                1,
                Math.min(1440, Math.round(Number(b.adPacing.dismissCooldownMinutes ?? prev.adPacing?.dismissCooldownMinutes ?? DEFAULT_AD_PACING.dismissCooldownMinutes)))
              ),
              largeAdIntervalMinutes: Math.max(
                0,
                Math.min(1440, Math.round(Number(b.adPacing.largeAdIntervalMinutes ?? prev.adPacing?.largeAdIntervalMinutes ?? DEFAULT_AD_PACING.largeAdIntervalMinutes)))
              ),
              playerAdIntervalMinutes: Math.max(
                0,
                Math.min(1440, Math.round(Number(b.adPacing.playerAdIntervalMinutes ?? prev.adPacing?.playerAdIntervalMinutes ?? DEFAULT_AD_PACING.playerAdIntervalMinutes)))
              ),
              headerAdAlwaysVisible:
                b.adPacing.headerAdAlwaysVisible !== undefined
                  ? Boolean(b.adPacing.headerAdAlwaysVisible)
                  : prev.adPacing?.headerAdAlwaysVisible ?? DEFAULT_AD_PACING.headerAdAlwaysVisible,
            }
          : {}),
      },
      defaultLanguage: typeof b.defaultLanguage === 'string' ? b.defaultLanguage.slice(0, 12) : prev.defaultLanguage,
      updatedAt: new Date().toISOString(),
    };
    saveAdmStore();
    audit(req, 'Configuração alterada', 'siteConfig', 'global', `Identidade/páginas atualizadas (${store.siteConfig.platformName})`);

    const isMaintenance = Boolean(store.siteConfig.maintenanceMode);
    let notification: {
      sent: boolean;
      mode: 'maintenance_on' | 'maintenance_off';
      campaignId?: string;
      targetedCount: number;
      successCount: number;
      note?: string;
    } | null = null;

    if (wasMaintenance !== isMaintenance) {
      const platformName = store.siteConfig.platformName || 'MOVIX';
      const mode: 'maintenance_on' | 'maintenance_off' = isMaintenance
        ? 'maintenance_on'
        : 'maintenance_off';
      const notifTitle = isMaintenance
        ? `${platformName} em manutenção`
        : `${platformName} está de volta!`;
      const notifBody = isMaintenance
        ? `O ${platformName} entrou em manutenção temporária para melhorias. Avisaremos assim que estiver de volta!`
        : `A manutenção foi concluída e o ${platformName} já está disponível novamente com todo o catálogo!`;

      try {
        const record = await sendOrScheduleAdminCampaign({
          title: notifTitle,
          body: notifBody,
          target_url: '#/',
          category: 'app_updates',
        });
        audit(
          req,
          isMaintenance ? 'Notificação de manutenção enviada' : 'Notificação de retorno enviada',
          'siteConfig',
          'maintenance',
          `${notifTitle} · ${record.success_count}/${record.targeted_count} dispositivos`
        );
        notification = {
          sent: true,
          mode,
          campaignId: record.id,
          targetedCount: record.targeted_count,
          successCount: record.success_count,
          note: record.note,
        };
      } catch (err) {
        notification = {
          sent: false,
          mode,
          targetedCount: 0,
          successCount: 0,
          note: err instanceof Error ? err.message : 'Falha ao enviar notificação de manutenção.',
        };
      }
    }

    res.json({ siteConfig: store.siteConfig, notification });
  });

  // =========================================================================
  // PROTECTED MOVIX ADM — MULTI-ADMIN RBAC & SESSION CONTROL
  // =========================================================================
  router.get('/api/adm/admins', requireAdminPermission('admins'), (_req, res) => {
    const safeAdmins = getAdmStore().admins.map(({ passwordHash: _p, ...rest }) => rest);
    res.json({
      admins: safeAdmins,
      allPermissions: ALL_ADMIN_PERMISSIONS,
      roleDefaults: ROLE_DEFAULT_PERMISSIONS,
    });
  });

  router.post('/api/adm/admins', requireAdminPermission('admins'), (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 140);
    const password = String(req.body?.password || '').trim();
    const role: AdminRole =
      req.body?.role === 'super_admin' || req.body?.role === 'editor' || req.body?.role === 'ads_manager'
        ? req.body.role
        : 'editor';

    if (!name || !email || !email.includes('@')) {
      res.status(400).json({ error: 'Nome e e-mail válido são obrigatórios.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
      return;
    }
    const store = getAdmStore();
    if (store.admins.some((a) => a.email.toLowerCase() === email)) {
      res.status(400).json({ error: 'Já existe um administrador com este e-mail.' });
      return;
    }

    const customPerms = Array.isArray(req.body?.permissions)
      ? (req.body.permissions.filter((p: unknown) =>
          ALL_ADMIN_PERMISSIONS.includes(p as AdminPermission)
        ) as AdminPermission[])
      : [...ROLE_DEFAULT_PERMISSIONS[role]];

    const acct: AdminAccount = {
      id: `adm_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      name,
      email,
      role,
      permissions: role === 'super_admin' ? [...ALL_ADMIN_PERMISSIONS] : customPerms,
      passwordHash: hashPasswordScrypt(password),
      active: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };
    store.admins.push(acct);
    saveAdmStore();
    audit(req, 'Administrador criado', 'admin', acct.id, `${acct.name} (${acct.role})`);
    const { passwordHash: _ignored, ...safe } = acct;
    res.json({ admin: safe });
  });

  router.put('/api/adm/admins/:id', requireAdminPermission('admins'), (req, res) => {
    const store = getAdmStore();
    const acct = store.admins.find((a) => a.id === req.params.id);
    if (!acct) {
      res.status(404).json({ error: 'Administrador não encontrado.' });
      return;
    }
    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
      acct.name = req.body.name.trim().slice(0, 80);
    }
    if (req.body?.role === 'super_admin' || req.body?.role === 'editor' || req.body?.role === 'ads_manager') {
      acct.role = req.body.role;
    }
    if (Array.isArray(req.body?.permissions)) {
      acct.permissions = req.body.permissions.filter((p: unknown) =>
        ALL_ADMIN_PERMISSIONS.includes(p as AdminPermission)
      ) as AdminPermission[];
    }
    if (acct.role === 'super_admin') {
      acct.permissions = [...ALL_ADMIN_PERMISSIONS];
    }
    if (typeof req.body?.active === 'boolean') {
      acct.active = req.body.active;
    }
    if (typeof req.body?.newPassword === 'string' && req.body.newPassword.trim().length >= 6) {
      acct.passwordHash = hashPasswordScrypt(req.body.newPassword.trim());
    }
    saveAdmStore();
    audit(req, 'Administrador atualizado', 'admin', acct.id, `${acct.name} (${acct.role})`);
    const { passwordHash: _ignored, ...safe } = acct;
    res.json({ admin: safe });
  });

  router.delete('/api/adm/admins/:id', requireAdminPermission('admins'), (req, res) => {
    const store = getAdmStore();
    if (req.adminSession?.adminId === req.params.id) {
      res.status(400).json({ error: 'Não pode eliminar a sua própria conta ativa.' });
      return;
    }
    const target = store.admins.find((a) => a.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'Administrador não encontrado.' });
      return;
    }
    store.admins = store.admins.filter((a) => a.id !== req.params.id);
    saveAdmStore();
    audit(req, 'Administrador eliminado', 'admin', target.id, target.email);
    res.json({ ok: true });
  });

  router.post('/api/adm/sessions/revoke-all', requireAdminPermission('admins'), (req, res) => {
    revokeAllAdminSessions();
    audit(req, 'Todas as sessões revogadas', 'security', 'sessions', 'Forçado novo início de sessão');
    res.json({ ok: true });
  });

  // =========================================================================
  // PROTECTED MOVIX ADM — AUDIT LOGS
  // =========================================================================
  router.get('/api/adm/logs', requireAdminPermission('logs'), (_req, res) => {
    res.json({ logs: getAdmStore().auditLogs });
  });

  // =========================================================================
  // PROTECTED MOVIX ADM — BACKUPS & RESTORE
  // =========================================================================
  router.get('/api/adm/backups', requireAdminPermission('backup'), (_req, res) => {
    res.json({ backups: getAdmStore().backups });
  });

  router.post('/api/adm/backups/create', requireAdminPermission('backup'), (req, res) => {
    const store = getAdmStore();
    const note = String(req.body?.note || 'Backup manual completo').slice(0, 140);
    const id = `bkp_${Date.now().toString(36)}`;
    const filename = `movix-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const fullPath = path.resolve(BACKUPS_DIR, filename);
    if (!fullPath.startsWith(BACKUPS_DIR + path.sep)) {
      res.status(400).json({ error: 'Caminho de backup inválido.' });
      return;
    }
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

    const payload = JSON.stringify(
      {
        version: 1,
        createdAt: new Date().toISOString(),
        admStore: store,
      },
      null,
      2
    );
    fs.writeFileSync(fullPath, payload, 'utf-8');
    const meta = {
      id,
      filename,
      createdAt: new Date().toISOString(),
      createdBy: req.adminSession?.name || 'Administrador',
      sizeBytes: Buffer.byteLength(payload, 'utf-8'),
      note,
    };
    store.backups = [meta, ...store.backups].slice(0, 40);
    saveAdmStore();
    audit(req, 'Backup criado', 'backup', id, `${filename} (${Math.round(meta.sizeBytes / 1024)} KB)`);
    res.json({ backup: meta, backups: store.backups });
  });

  router.get('/api/adm/backups/:id/download', requireAdminPermission('backup'), (req, res) => {
    const store = getAdmStore();
    const meta = store.backups.find((b) => b.id === req.params.id);
    if (!meta || !/^[a-zA-Z0-9._-]+$/.test(meta.filename)) {
      res.status(404).json({ error: 'Backup não encontrado.' });
      return;
    }
    const fullPath = path.resolve(BACKUPS_DIR, meta.filename);
    if (!fullPath.startsWith(BACKUPS_DIR + path.sep) || !fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Ficheiro de backup em falta.' });
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${meta.filename}"`);
    res.sendFile(fullPath);
  });

  router.post('/api/adm/backups/:id/restore', requireAdminPermission('backup'), (req, res) => {
    const store = getAdmStore();
    const meta = store.backups.find((b) => b.id === req.params.id);
    if (!meta || !/^[a-zA-Z0-9._-]+$/.test(meta.filename)) {
      res.status(404).json({ error: 'Backup não encontrado.' });
      return;
    }
    const fullPath = path.resolve(BACKUPS_DIR, meta.filename);
    if (!fullPath.startsWith(BACKUPS_DIR + path.sep) || !fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Ficheiro de backup em falta.' });
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as { admStore?: AdmStoreData };
      if (!parsed.admStore || !Array.isArray(parsed.admStore.movies)) {
        res.status(400).json({ error: 'Ficheiro de backup corrompido.' });
        return;
      }
      // Preserve current backups list & current admin credentials to prevent lockout
      const restored: AdmStoreData = {
        ...parsed.admStore,
        admins: store.admins.length > 0 ? store.admins : parsed.admStore.admins,
        backups: store.backups,
      };
      replaceAdmStore(restored);
      audit(req, 'Backup restaurado', 'backup', meta.id, meta.filename);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Falha ao restaurar backup.' });
    }
  });

  // =========================================================================
  // PROTECTED MOVIX ADM — CLOUD FIRESTORE REHYDRATION AFTER CONTAINER UPDATES
  // =========================================================================
  router.post('/api/adm/rehydrate-cloud', requireAdmin, (req, res) => {
    const admStore = getAdmStore();
    const pubStore = getStore();
    const body = (req.body || {}) as Record<string, unknown>;
    const restoredCounts = {
      siteConfig: false,
      ads: 0,
      movies: 0,
      series: 0,
      genres: 0,
      servers: 0,
      banners: 0,
      highlights: 0,
      categories: 0,
      mediaFiles: 0,
    };

    const parseTime = (iso: unknown): number => {
      if (typeof iso !== 'string' || !iso) return 0;
      const ms = Date.parse(iso);
      return Number.isFinite(ms) ? ms : 0;
    };

    // 1. Rehydrate cloud-backed media assets to data/uploads/{folder}/{filename}
    if (Array.isArray(body.mediaAssets)) {
      const assets = body.mediaAssets.slice(0, 50) as Array<{
        folder?: unknown;
        filename?: unknown;
        dataUrl?: unknown;
      }>;
      for (const asset of assets) {
        const folder = typeof asset.folder === 'string' ? asset.folder : '';
        const filename = typeof asset.filename === 'string' ? asset.filename : '';
        const dataUrl = typeof asset.dataUrl === 'string' ? asset.dataUrl : '';
        if (!folder || !filename || dataUrl.length < 20 || dataUrl.length > 720000) continue;
        const commaIdx = dataUrl.indexOf(',');
        if (commaIdx <= 0 || !dataUrl.slice(0, commaIdx).includes(';base64')) continue;
        try {
          const buf = Buffer.from(dataUrl.slice(commaIdx + 1), 'base64');
          const result = restoreUploadedBuffer({ buffer: buf, folder, filename });
          if (result.ok && result.restored) {
            restoredCounts.mediaFiles += 1;
          }
        } catch {
          // ignore malformed asset
        }
      }
    }

    // 2. Rehydrate siteConfig if cloud is newer or local has not been customized
    if (body.siteConfig && typeof body.siteConfig === 'object') {
      const c = body.siteConfig as Record<string, unknown>;
      const cloudTime = parseTime(c.updatedAt);
      const localTime = parseTime(admStore.siteConfig.updatedAt);
      const localLooksDefault =
        !admStore.siteConfig.logoUrl &&
        !admStore.siteConfig.aboutUs &&
        !admStore.siteConfig.contactEmail &&
        admStore.ads.length === 0;
      if (cloudTime >= localTime || localLooksDefault) {
        const prev = admStore.siteConfig;
        const primaryColor =
          typeof c.primaryColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.primaryColor.trim())
            ? c.primaryColor.trim()
            : prev.primaryColor;
        const rawPacing = (c.adPacing && typeof c.adPacing === 'object' ? c.adPacing : {}) as Record<string, unknown>;
        admStore.siteConfig = {
          platformName:
            typeof c.platformName === 'string' && c.platformName.trim()
              ? c.platformName.trim().slice(0, 60)
              : prev.platformName,
          logoUrl: typeof c.logoUrl === 'string' ? safeUrl(c.logoUrl, true) : prev.logoUrl,
          faviconUrl: typeof c.faviconUrl === 'string' ? safeUrl(c.faviconUrl, true) : prev.faviconUrl,
          primaryColor,
          heroTagline: typeof c.heroTagline === 'string' ? c.heroTagline.slice(0, 200) : prev.heroTagline,
          aboutUs: typeof c.aboutUs === 'string' && c.aboutUs ? c.aboutUs.slice(0, 5000) : prev.aboutUs,
          privacyPolicy:
            typeof c.privacyPolicy === 'string' && c.privacyPolicy ? c.privacyPolicy.slice(0, 8000) : prev.privacyPolicy,
          termsOfUse:
            typeof c.termsOfUse === 'string' && c.termsOfUse ? c.termsOfUse.slice(0, 8000) : prev.termsOfUse,
          contactEmail:
            typeof c.contactEmail === 'string' && c.contactEmail ? c.contactEmail.trim().slice(0, 120) : prev.contactEmail,
          contactPhone:
            typeof c.contactPhone === 'string' && c.contactPhone ? c.contactPhone.trim().slice(0, 40) : prev.contactPhone,
          socialInstagram:
            typeof c.socialInstagram === 'string' && c.socialInstagram
              ? safeUrl(c.socialInstagram, false)
              : prev.socialInstagram,
          socialYoutube:
            typeof c.socialYoutube === 'string' && c.socialYoutube
              ? safeUrl(c.socialYoutube, false)
              : prev.socialYoutube,
          socialTelegram:
            typeof c.socialTelegram === 'string' && c.socialTelegram
              ? safeUrl(c.socialTelegram, false)
              : prev.socialTelegram,
          socialTwitter:
            typeof c.socialTwitter === 'string' && c.socialTwitter
              ? safeUrl(c.socialTwitter, false)
              : prev.socialTwitter,
          seoTitle: typeof c.seoTitle === 'string' && c.seoTitle ? c.seoTitle.slice(0, 120) : prev.seoTitle,
          seoDescription:
            typeof c.seoDescription === 'string' ? c.seoDescription.slice(0, 320) : prev.seoDescription,
          seoKeywords:
            typeof c.seoKeywords === 'string' && c.seoKeywords ? c.seoKeywords.slice(0, 300) : prev.seoKeywords,
          maintenanceMode:
            typeof c.maintenanceMode === 'boolean' ? c.maintenanceMode : prev.maintenanceMode,
          adsGlobalEnabled:
            typeof c.adsGlobalEnabled === 'boolean' ? c.adsGlobalEnabled : prev.adsGlobalEnabled,
          adPacing: {
            dismissCooldownMinutes: Math.max(
              1,
              Math.min(
                1440,
                Math.round(
                  Number(
                    rawPacing.dismissCooldownMinutes ??
                      c.dismissCooldownMinutes ??
                      prev.adPacing?.dismissCooldownMinutes ??
                      DEFAULT_AD_PACING.dismissCooldownMinutes
                  )
                )
              )
            ),
            largeAdIntervalMinutes: Math.max(
              0,
              Math.min(
                1440,
                Math.round(
                  Number(
                    rawPacing.largeAdIntervalMinutes ??
                      c.largeAdIntervalMinutes ??
                      prev.adPacing?.largeAdIntervalMinutes ??
                      DEFAULT_AD_PACING.largeAdIntervalMinutes
                  )
                )
              )
            ),
            playerAdIntervalMinutes: Math.max(
              0,
              Math.min(
                1440,
                Math.round(
                  Number(
                    rawPacing.playerAdIntervalMinutes ??
                      c.playerAdIntervalMinutes ??
                      prev.adPacing?.playerAdIntervalMinutes ??
                      DEFAULT_AD_PACING.playerAdIntervalMinutes
                  )
                )
              )
            ),
            headerAdAlwaysVisible:
              typeof rawPacing.headerAdAlwaysVisible === 'boolean'
                ? rawPacing.headerAdAlwaysVisible
                : typeof c.headerAdAlwaysVisible === 'boolean'
                  ? c.headerAdAlwaysVisible
                  : prev.adPacing?.headerAdAlwaysVisible ?? DEFAULT_AD_PACING.headerAdAlwaysVisible,
          },
          defaultLanguage:
            typeof c.defaultLanguage === 'string' && c.defaultLanguage
              ? c.defaultLanguage.slice(0, 12)
              : prev.defaultLanguage,
          updatedAt: typeof c.updatedAt === 'string' && c.updatedAt ? c.updatedAt : new Date().toISOString(),
        };
        restoredCounts.siteConfig = true;
      }
    }

    // 3. Rehydrate ad campaigns (merge without losing newer local edits or accumulated stats)
    if (Array.isArray(body.ads) && body.ads.length > 0) {
      for (const rawAd of body.ads.slice(0, 100) as Record<string, unknown>[]) {
        const id = typeof rawAd?.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(rawAd.id) ? rawAd.id : '';
        if (!id) continue;
        const existingIdx = admStore.ads.findIndex((a) => a.id === id);
        if (existingIdx < 0) {
          const sanitized = buildSanitizedAd(rawAd);
          sanitized.impressions = Math.max(0, Math.floor(Number(rawAd.impressions || 0)));
          sanitized.clicks = Math.max(0, Math.floor(Number(rawAd.clicks || 0)));
          sanitized.videoViews = Math.max(0, Math.floor(Number(rawAd.videoViews || 0)));
          sanitized.videoCompletes = Math.max(0, Math.floor(Number(rawAd.videoCompletes || 0)));
          sanitized.videoPartials = Math.max(0, Math.floor(Number(rawAd.videoPartials || 0)));
          sanitized.totalWatchSeconds = Math.max(0, Number(rawAd.totalWatchSeconds || 0));
          if (typeof rawAd.createdAt === 'string' && rawAd.createdAt) sanitized.createdAt = rawAd.createdAt;
          if (typeof rawAd.updatedAt === 'string' && rawAd.updatedAt) sanitized.updatedAt = rawAd.updatedAt;
          admStore.ads.push(sanitized);
          restoredCounts.ads += 1;
          if (sanitized.status === 'active') {
            void prewarmAdTranslations(sanitized);
          }
        } else {
          const localAd = admStore.ads[existingIdx];
          if (parseTime(rawAd.updatedAt) > parseTime(localAd.updatedAt)) {
            const merged = buildSanitizedAd(rawAd, localAd);
            merged.impressions = Math.max(localAd.impressions || 0, Math.floor(Number(rawAd.impressions || 0)));
            merged.clicks = Math.max(localAd.clicks || 0, Math.floor(Number(rawAd.clicks || 0)));
            merged.videoViews = Math.max(localAd.videoViews || 0, Math.floor(Number(rawAd.videoViews || 0)));
            merged.videoCompletes = Math.max(
              localAd.videoCompletes || 0,
              Math.floor(Number(rawAd.videoCompletes || 0))
            );
            merged.videoPartials = Math.max(localAd.videoPartials || 0, Math.floor(Number(rawAd.videoPartials || 0)));
            merged.totalWatchSeconds = Math.max(localAd.totalWatchSeconds || 0, Number(rawAd.totalWatchSeconds || 0));
            if (typeof rawAd.updatedAt === 'string' && rawAd.updatedAt) merged.updatedAt = rawAd.updatedAt;
            admStore.ads[existingIdx] = merged;
            restoredCounts.ads += 1;
          }
        }
      }
    }

    // 4. Rehydrate movies
    if (Array.isArray(body.movies) && body.movies.length > 0) {
      for (const raw of body.movies.slice(0, 200) as Partial<ManagedMovie>[]) {
        const id = typeof raw?.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(raw.id) ? raw.id : '';
        const title = typeof raw?.title === 'string' ? raw.title.trim().slice(0, 160) : '';
        if (!id || !title) continue;
        const existingIdx = admStore.movies.findIndex((m) => m.id === id);
        const now = new Date().toISOString();
        const sanitized: ManagedMovie = {
          id,
          tmdbId: typeof raw.tmdbId === 'number' && Number.isFinite(raw.tmdbId) ? Math.floor(raw.tmdbId) : null,
          title,
          originalTitle: String(raw.originalTitle || title).slice(0, 160),
          overview: String(raw.overview || '').slice(0, 3000),
          posterUrl: safeUrl(raw.posterUrl, true),
          backdropUrl: safeUrl(raw.backdropUrl, true),
          trailerUrl: safeUrl(raw.trailerUrl, false),
          releaseDate: String(raw.releaseDate || '').slice(0, 25),
          year: String(raw.year || '').slice(0, 10),
          runtime: Math.max(0, Math.min(1000, Math.floor(Number(raw.runtime || 0)))),
          language: String(raw.language || 'pt-BR').slice(0, 30),
          certification: String(raw.certification || '14').slice(0, 16),
          rating: Math.max(0, Math.min(10, Number(raw.rating || 0))),
          categories: Array.isArray(raw.categories)
            ? raw.categories.map((x) => String(x).slice(0, 40)).filter(Boolean).slice(0, 12)
            : ['Filmes'],
          genres: Array.isArray(raw.genres)
            ? raw.genres.map((x) => String(x).slice(0, 40)).filter(Boolean).slice(0, 12)
            : [],
          servers: sanitizeServers(raw.servers),
          featured: Boolean(raw.featured),
          recommended: Boolean(raw.recommended),
          published: raw.published !== false,
          views: Math.max(0, Math.floor(Number(raw.views || 0))),
          createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : now,
          updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : now,
        };
        if (existingIdx < 0) {
          admStore.movies.push(sanitized);
          restoredCounts.movies += 1;
        } else if (parseTime(sanitized.updatedAt) > parseTime(admStore.movies[existingIdx].updatedAt)) {
          sanitized.views = Math.max(sanitized.views, admStore.movies[existingIdx].views || 0);
          admStore.movies[existingIdx] = sanitized;
          restoredCounts.movies += 1;
        }
      }
    }

    // 5. Rehydrate series (including nested seasons & episodes)
    if (Array.isArray(body.series) && body.series.length > 0) {
      for (const raw of body.series.slice(0, 200) as Partial<ManagedSeries>[]) {
        const id = typeof raw?.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(raw.id) ? raw.id : '';
        const title = typeof raw?.title === 'string' ? raw.title.trim().slice(0, 160) : '';
        if (!id || !title) continue;
        const existingIdx = admStore.series.findIndex((s) => s.id === id);
        const now = new Date().toISOString();
        const seasons: ManagedSeason[] = Array.isArray(raw.seasons)
          ? raw.seasons.slice(0, 40).map((s, sIdx) => ({
              id: String(s.id || `sea_${id}_${sIdx + 1}`).slice(0, 80),
              seasonNumber: Math.max(0, Math.floor(Number(s.seasonNumber ?? sIdx + 1))),
              title: String(s.title || `Temporada ${sIdx + 1}`).slice(0, 120),
              overview: String(s.overview || '').slice(0, 2000),
              posterUrl: safeUrl(s.posterUrl, true),
              published: s.published !== false,
              episodes: Array.isArray(s.episodes)
                ? s.episodes.slice(0, 200).map((ep, eIdx): ManagedEpisode => ({
                    id: String(ep.id || `ep_${id}_${sIdx + 1}_${eIdx + 1}`).slice(0, 80),
                    episodeNumber: Math.max(1, Math.floor(Number(ep.episodeNumber ?? eIdx + 1))),
                    title: String(ep.title || `Episódio ${eIdx + 1}`).slice(0, 140),
                    overview: String(ep.overview || '').slice(0, 2000),
                    stillUrl: safeUrl(ep.stillUrl, true),
                    duration: Math.max(0, Math.min(600, Math.floor(Number(ep.duration || 45)))),
                    airDate: String(ep.airDate || '').slice(0, 25),
                    servers: sanitizeServers(ep.servers),
                    published: ep.published !== false,
                    views: Math.max(0, Math.floor(Number(ep.views || 0))),
                    createdAt: typeof ep.createdAt === 'string' && ep.createdAt ? ep.createdAt : now,
                    updatedAt: typeof ep.updatedAt === 'string' && ep.updatedAt ? ep.updatedAt : now,
                  }))
                : [],
              createdAt: typeof s.createdAt === 'string' && s.createdAt ? s.createdAt : now,
              updatedAt: typeof s.updatedAt === 'string' && s.updatedAt ? s.updatedAt : now,
            }))
          : [];
        const sanitized: ManagedSeries = {
          id,
          tmdbId: typeof raw.tmdbId === 'number' && Number.isFinite(raw.tmdbId) ? Math.floor(raw.tmdbId) : null,
          title,
          originalTitle: String(raw.originalTitle || title).slice(0, 160),
          overview: String(raw.overview || '').slice(0, 3000),
          posterUrl: safeUrl(raw.posterUrl, true),
          backdropUrl: safeUrl(raw.backdropUrl, true),
          trailerUrl: safeUrl(raw.trailerUrl, false),
          releaseDate: String(raw.releaseDate || '').slice(0, 25),
          year: String(raw.year || '').slice(0, 10),
          language: String(raw.language || 'pt-BR').slice(0, 30),
          certification: String(raw.certification || '14').slice(0, 16),
          rating: Math.max(0, Math.min(10, Number(raw.rating || 0))),
          categories: Array.isArray(raw.categories)
            ? raw.categories.map((x) => String(x).slice(0, 40)).filter(Boolean).slice(0, 12)
            : ['Séries'],
          genres: Array.isArray(raw.genres)
            ? raw.genres.map((x) => String(x).slice(0, 40)).filter(Boolean).slice(0, 12)
            : [],
          featured: Boolean(raw.featured),
          recommended: Boolean(raw.recommended),
          published: raw.published !== false,
          views: Math.max(0, Math.floor(Number(raw.views || 0))),
          seasons,
          createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : now,
          updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : now,
        };
        if (existingIdx < 0) {
          admStore.series.push(sanitized);
          restoredCounts.series += 1;
        } else if (parseTime(sanitized.updatedAt) > parseTime(admStore.series[existingIdx].updatedAt)) {
          sanitized.views = Math.max(sanitized.views, admStore.series[existingIdx].views || 0);
          admStore.series[existingIdx] = sanitized;
          restoredCounts.series += 1;
        }
      }
    }

    // 6. Rehydrate catalog lists (only mutate & count when content actually differs)
    if (Array.isArray(body.genres) && body.genres.length > 0) {
      const nextGenres: ManagedGenre[] = (body.genres as Partial<ManagedGenre>[]).slice(0, 100).map((g, idx) => ({
        id: String(g.id || `gen_${idx + 1}`).slice(0, 80),
        name: String(g.name || `Género ${idx + 1}`).trim().slice(0, 60),
        slug: String(g.slug || `gen-${idx + 1}`).trim().slice(0, 60),
        mediaType: g.mediaType === 'movie' || g.mediaType === 'tv' ? g.mediaType : 'both',
        active: g.active !== false,
        order: Number.isFinite(Number(g.order)) ? Number(g.order) : idx + 1,
      }));
      if (JSON.stringify(admStore.genres) !== JSON.stringify(nextGenres)) {
        admStore.genres = nextGenres;
        restoredCounts.genres = nextGenres.length;
      }
    }

    if (Array.isArray(body.servers) && body.servers.length > 0) {
      const nextServers: GlobalPlaybackServer[] = (body.servers as Partial<GlobalPlaybackServer>[]).slice(0, 100).map((s, idx) => ({
        id: String(s.id || `srv_${idx + 1}`).slice(0, 80),
        name: String(s.name || `Servidor ${idx + 1}`).trim().slice(0, 80),
        baseUrl: safeUrl(s.baseUrl, false),
        kind: s.kind === 'stream' || s.kind === 'hls' ? s.kind : 'embed',
        active: s.active !== false,
        isDefault: Boolean(s.isDefault),
        order: Number.isFinite(Number(s.order)) ? Number(s.order) : idx + 1,
        lastTestedAt: typeof s.lastTestedAt === 'string' ? s.lastTestedAt : null,
        lastStatus: s.lastStatus === 'online' || s.lastStatus === 'offline' ? s.lastStatus : 'unknown',
        lastLatencyMs: typeof s.lastLatencyMs === 'number' ? s.lastLatencyMs : null,
      }));
      if (JSON.stringify(admStore.servers) !== JSON.stringify(nextServers)) {
        admStore.servers = nextServers;
        restoredCounts.servers = nextServers.length;
      }
    }

    if (Array.isArray(body.banners) && (body.banners.length > 0 || pubStore.banners.length === 0)) {
      const nextBanners: BannerItem[] = (body.banners as Partial<BannerItem>[]).slice(0, 100).map((b, idx) => ({
        id: String(b.id || `ban_${idx + 1}`).slice(0, 80),
        title: String(b.title || `Banner ${idx + 1}`).slice(0, 160),
        subtitle: String(b.subtitle || '').slice(0, 300),
        tmdbId: typeof b.tmdbId === 'number' && Number.isFinite(b.tmdbId) ? Math.floor(b.tmdbId) : null,
        mediaType: b.mediaType === 'tv' ? 'tv' : 'movie',
        backdropUrl: safeUrl(b.backdropUrl, true),
        posterUrl: safeUrl(b.posterUrl, true),
        year: String(b.year || '').slice(0, 10),
        rating: Math.max(0, Math.min(10, Number(b.rating || 0))),
        genres: Array.isArray(b.genres) ? b.genres.map((g) => String(g).slice(0, 40)).slice(0, 8) : [],
        active: b.active !== false,
        order: Number.isFinite(Number(b.order)) ? Number(b.order) : idx + 1,
      }));
      if (JSON.stringify(pubStore.banners) !== JSON.stringify(nextBanners)) {
        setBanners(nextBanners);
        restoredCounts.banners = nextBanners.length;
      }
    }

    if (Array.isArray(body.highlights) && (body.highlights.length > 0 || pubStore.highlights.length === 0)) {
      const nextHighlights: HighlightItem[] = (body.highlights as Partial<HighlightItem>[]).slice(0, 100).map((h, idx) => ({
        id: String(h.id || `hl_${idx + 1}`).slice(0, 80),
        tmdbId: Math.max(1, Math.floor(Number(h.tmdbId || 1))),
        mediaType: h.mediaType === 'tv' ? 'tv' : 'movie',
        title: String(h.title || `Destaque ${idx + 1}`).slice(0, 160),
        posterUrl: safeUrl(h.posterUrl, true),
        backdropUrl: safeUrl(h.backdropUrl, true),
        year: String(h.year || '').slice(0, 10),
        rating: Math.max(0, Math.min(10, Number(h.rating || 0))),
        label: String(h.label || 'Destaque').slice(0, 60),
        active: h.active !== false,
        order: Number.isFinite(Number(h.order)) ? Number(h.order) : idx + 1,
      }));
      if (JSON.stringify(pubStore.highlights) !== JSON.stringify(nextHighlights)) {
        setHighlights(nextHighlights);
        restoredCounts.highlights = nextHighlights.length;
      }
    }

    if (Array.isArray(body.categories) && body.categories.length > 0) {
      const nextCategories: ManagedCategory[] = (body.categories as Partial<ManagedCategory>[]).slice(0, 100).map((c, idx) => ({
        id: String(c.id || `cat_${idx + 1}`).slice(0, 80),
        name: String(c.name || `Categoria ${idx + 1}`).slice(0, 80),
        source: c.source === 'megambd' ? 'megambd' : 'tmdb',
        externalId: String(c.externalId || 'popular').slice(0, 80),
        mediaType: c.mediaType === 'tv' ? 'tv' : 'movie',
        imageUrl: typeof c.imageUrl === 'string' ? safeUrl(c.imageUrl, true) : '',
        visible: c.visible !== false,
        order: Number.isFinite(Number(c.order)) ? Number(c.order) : idx + 1,
      }));
      if (JSON.stringify(pubStore.categories) !== JSON.stringify(nextCategories)) {
        setCategories(nextCategories);
        restoredCounts.categories = nextCategories.length;
      }
    }

    const changed = Boolean(
      restoredCounts.mediaFiles > 0 ||
        restoredCounts.siteConfig ||
        restoredCounts.ads > 0 ||
        restoredCounts.movies > 0 ||
        restoredCounts.series > 0 ||
        restoredCounts.genres > 0 ||
        restoredCounts.servers > 0 ||
        restoredCounts.banners > 0 ||
        restoredCounts.highlights > 0 ||
        restoredCounts.categories > 0
    );

    if (changed) {
      saveAdmStore();
      broadcastConfigSyncEvent();
    }
    res.json({ ok: true, changed, restoredCounts });
  });

  return router;
}
