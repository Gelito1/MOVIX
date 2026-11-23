import type { BannerItem, HighlightItem, ManagedCategory } from '../types/movix';
import type {
  AdCampaign,
  GlobalPlaybackServer,
  ManagedGenre,
  ManagedMovie,
  ManagedSeries,
  SiteIdentityConfig,
} from '../types/adm';
import { admApi } from './admApi';
import {
  applyCloudConfigToSiteConfig,
  cloudAdToCampaignFallback,
  extractCloudMediaId,
  fetchCloudCatalogList,
  fetchCloudMediaAsset,
  fetchCloudMovies,
  fetchCloudPublicAds,
  fetchCloudSeries,
  fetchCloudSystemConfig,
  isVerifiedFirebaseAdmin,
  upsertCloudCatalogList,
  upsertCloudMovie,
  upsertCloudPublicAd,
  upsertCloudSeries,
  upsertCloudSystemConfig,
} from './firebase';

export interface CloudReconcileSummary {
  rehydratedToServer: boolean;
  pushedToCloud: boolean;
  cloudAuthorized: boolean;
  counts: {
    ads: number;
    movies: number;
    series: number;
    banners: number;
    highlights: number;
    categories: number;
    genres: number;
    servers: number;
    mediaRestored: number;
  };
}

let inFlightReconcile: Promise<CloudReconcileSummary> | null = null;

function parseIsoMs(iso: string | undefined | null): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function collectCloudMediaIds(sources: Array<string | undefined | null>): string[] {
  const ids = new Set<string>();
  for (const url of sources) {
    const id = extractCloudMediaId(url);
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

async function fetchAdminJson<T>(url: string, token: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Performs a safe, zero-overwrite bi-directional reconciliation between the
 * current Express container and permanent Cloud Firestore storage:
 * 1. Pulls ALL permanent datasets from Cloud Firestore (siteConfig, ads, movies,
 *    series, banners, highlights, categories, genres, servers, and `?cm=` media assets).
 * 2. Rehydrates any missing or newer cloud records + media files into the current
 *    Express container via `POST /api/adm/rehydrate-cloud` so the public site and
 *    ADM panel immediately recover 100% of data after an app update or container reset.
 * 3. When Google admin auth is active (`isVerifiedFirebaseAdmin()`), pushes any
 *    local-only or newer container items UP to Cloud Firestore so nothing is ever lost.
 *    NEVER lets an empty/fresh container overwrite non-empty cloud data!
 */
export async function reconcileAllAdmWithCloud(
  adminToken: string,
  options?: { forcePushLocalToCloud?: boolean }
): Promise<CloudReconcileSummary> {
  if (inFlightReconcile && !options?.forcePushLocalToCloud) {
    return inFlightReconcile;
  }

  const run = async (): Promise<CloudReconcileSummary> => {
    const cloudAuthorized = isVerifiedFirebaseAdmin();
    const summary: CloudReconcileSummary = {
      rehydratedToServer: false,
      pushedToCloud: false,
      cloudAuthorized,
      counts: {
        ads: 0,
        movies: 0,
        series: 0,
        banners: 0,
        highlights: 0,
        categories: 0,
        genres: 0,
        servers: 0,
        mediaRestored: 0,
      },
    };

    // Fetch cloud datasets & local server datasets in parallel
    const [
      cloudConfig,
      cloudAdsRaw,
      cloudMovies,
      cloudSeries,
      cloudBanners,
      cloudHighlights,
      cloudCategories,
      cloudGenres,
      cloudServers,
      localSiteCfgRes,
      localAdsRes,
      localMoviesRes,
      localSeriesRes,
      localGenresRes,
      localServersRes,
      localBannersRes,
      localHighlightsRes,
      localCategoriesRes,
    ] = await Promise.all([
      fetchCloudSystemConfig().catch(() => null),
      fetchCloudPublicAds(cloudAuthorized).catch(() => []),
      fetchCloudMovies(cloudAuthorized).catch(() => []),
      fetchCloudSeries(cloudAuthorized).catch(() => []),
      fetchCloudCatalogList<BannerItem>('banners').catch(() => null),
      fetchCloudCatalogList<HighlightItem>('highlights').catch(() => null),
      fetchCloudCatalogList<ManagedCategory>('categories').catch(() => null),
      fetchCloudCatalogList<ManagedGenre>('genres').catch(() => null),
      fetchCloudCatalogList<GlobalPlaybackServer>('servers').catch(() => null),
      admApi.getSiteConfig(adminToken).catch(() => null),
      admApi.listAds(adminToken).catch(() => null),
      admApi.listMovies(adminToken).catch(() => null),
      admApi.listSeries(adminToken).catch(() => null),
      admApi.listGenres(adminToken).catch(() => null),
      admApi.listServers(adminToken).catch(() => null),
      fetchAdminJson<{ banners: BannerItem[] }>('/api/admin/banners', adminToken),
      fetchAdminJson<{ highlights: HighlightItem[] }>('/api/admin/highlights', adminToken),
      fetchAdminJson<{ categories: ManagedCategory[] }>('/api/admin/categories', adminToken),
    ]);

    const localSiteConfig: SiteIdentityConfig | null = localSiteCfgRes?.siteConfig || null;
    const localAds: AdCampaign[] = localAdsRes?.ads || [];
    const localMovies: ManagedMovie[] = localMoviesRes?.movies || [];
    const localSeries: ManagedSeries[] = localSeriesRes?.series || [];
    const localGenres: ManagedGenre[] = localGenresRes?.genres || [];
    const localServers: GlobalPlaybackServer[] = localServersRes?.servers || [];
    const localBanners: BannerItem[] = localBannersRes?.banners || [];
    const localHighlights: HighlightItem[] = localHighlightsRes?.highlights || [];
    const localCategories: ManagedCategory[] = localCategoriesRes?.categories || [];

    const cloudAds: AdCampaign[] = cloudAdsRaw.map(cloudAdToCampaignFallback);

    // Collect all referenced `?cm={mediaId}` URLs across cloud datasets so we can restore
    // missing image/media files back onto Express container disk!
    const allUrls: Array<string | undefined | null> = [
      cloudConfig?.logoUrl,
      cloudConfig?.faviconUrl,
      ...cloudAds.flatMap((a) => [a.imageUrl, a.videoUrl]),
      ...cloudMovies.flatMap((m) => [m.posterUrl, m.backdropUrl]),
      ...cloudSeries.flatMap((s) => [
        s.posterUrl,
        s.backdropUrl,
        ...s.seasons.flatMap((sea) => [sea.posterUrl, ...sea.episodes.map((ep) => ep.stillUrl)]),
      ]),
      ...(cloudBanners || []).flatMap((b) => [b.backdropUrl, b.posterUrl]),
      ...(cloudHighlights || []).flatMap((h) => [h.posterUrl, h.backdropUrl]),
      ...(cloudCategories || []).map((c) => c.imageUrl),
    ];

    const mediaIds = collectCloudMediaIds(allUrls).slice(0, 50);
    const mediaAssets: Array<{ folder: string; filename: string; dataUrl: string }> = [];
    if (mediaIds.length > 0) {
      const fetchedAssets = await Promise.all(mediaIds.map((id) => fetchCloudMediaAsset(id)));
      for (const asset of fetchedAssets) {
        if (asset) {
          mediaAssets.push({
            folder: asset.folder,
            filename: asset.filename,
            dataUrl: asset.dataUrl,
          });
        }
      }
    }

    // 1. Rehydrate Express container from Cloud Firestore (whenever cloud has data)
    const shouldRehydrate =
      Boolean(cloudConfig) ||
      cloudAds.length > 0 ||
      cloudMovies.length > 0 ||
      cloudSeries.length > 0 ||
      Boolean(cloudBanners && cloudBanners.length > 0) ||
      Boolean(cloudHighlights && cloudHighlights.length > 0) ||
      Boolean(cloudCategories && cloudCategories.length > 0) ||
      Boolean(cloudGenres && cloudGenres.length > 0) ||
      Boolean(cloudServers && cloudServers.length > 0) ||
      mediaAssets.length > 0;

    if (shouldRehydrate) {
      const mergedSiteCfgForServer = cloudConfig
        ? applyCloudConfigToSiteConfig(localSiteConfig, cloudConfig)
        : undefined;
      try {
        const rehydRes = await admApi.rehydrateCloud(adminToken, {
          siteConfig: mergedSiteCfgForServer,
          ads: cloudAds.length > 0 ? cloudAds : undefined,
          movies: cloudMovies.length > 0 ? cloudMovies : undefined,
          series: cloudSeries.length > 0 ? cloudSeries : undefined,
          genres: cloudGenres && cloudGenres.length > 0 ? cloudGenres : undefined,
          servers: cloudServers && cloudServers.length > 0 ? cloudServers : undefined,
          banners: cloudBanners && cloudBanners.length > 0 ? cloudBanners : undefined,
          highlights: cloudHighlights && cloudHighlights.length > 0 ? cloudHighlights : undefined,
          categories: cloudCategories && cloudCategories.length > 0 ? cloudCategories : undefined,
          mediaAssets: mediaAssets.length > 0 ? mediaAssets : undefined,
        });
        const hasAnyRestored =
          rehydRes.changed === true ||
          (rehydRes.changed === undefined &&
            Object.values(rehydRes.restoredCounts || {}).some(
              (v) => v === true || (typeof v === 'number' && v > 0)
            ));
        summary.rehydratedToServer = Boolean(rehydRes.ok && hasAnyRestored);
        summary.counts.mediaRestored = Number(rehydRes.restoredCounts?.mediaFiles || 0);
      } catch (err) {
        console.warn('[MOVIX Cloud Sync] Server rehydration warning:', err);
      }
    }

    // 2. Push any local-only or newer container items UP to Cloud Firestore when verified Google admin is connected
    if (cloudAuthorized) {
      const pushTasks: Promise<unknown>[] = [];

      // SiteConfig: push if cloud doesn't exist yet OR local is newer OR forcePush
      if (
        localSiteConfig &&
        (!cloudConfig ||
          options?.forcePushLocalToCloud ||
          parseIsoMs(localSiteConfig.updatedAt) > parseIsoMs(cloudConfig.updatedAt))
      ) {
        pushTasks.push(
          upsertCloudSystemConfig(
            {
              platformName: localSiteConfig.platformName,
              logoUrl: localSiteConfig.logoUrl,
              faviconUrl: localSiteConfig.faviconUrl,
              primaryColor: localSiteConfig.primaryColor,
              heroTagline: localSiteConfig.heroTagline,
              seoTitle: localSiteConfig.seoTitle,
              seoDescription: localSiteConfig.seoDescription,
              seoKeywords: localSiteConfig.seoKeywords,
              aboutUs: localSiteConfig.aboutUs,
              privacyPolicy: localSiteConfig.privacyPolicy,
              termsOfUse: localSiteConfig.termsOfUse,
              contactEmail: localSiteConfig.contactEmail,
              contactPhone: localSiteConfig.contactPhone,
              socialInstagram: localSiteConfig.socialInstagram,
              socialYoutube: localSiteConfig.socialYoutube,
              socialTelegram: localSiteConfig.socialTelegram,
              socialTwitter: localSiteConfig.socialTwitter,
              defaultLanguage: localSiteConfig.defaultLanguage as SiteIdentityConfig['defaultLanguage'] as never,
              maintenanceMode: localSiteConfig.maintenanceMode,
              adsGlobalEnabled: localSiteConfig.adsGlobalEnabled,
              dismissCooldownMinutes: localSiteConfig.adPacing?.dismissCooldownMinutes,
              largeAdIntervalMinutes: localSiteConfig.adPacing?.largeAdIntervalMinutes,
              playerAdIntervalMinutes: localSiteConfig.adPacing?.playerAdIntervalMinutes,
              headerAdAlwaysVisible: localSiteConfig.adPacing?.headerAdAlwaysVisible,
            },
            localSiteConfig
          )
        );
      }

      // Ads: push any local ad missing in cloud or newer than cloud (or status/metrics changed)
      const cloudAdsById = new Map(cloudAds.map((a) => [a.id, a]));
      for (const localAd of localAds) {
        const cloudMatch = cloudAdsById.get(localAd.id);
        const localMs = parseIsoMs(localAd.updatedAt);
        const cloudMs = cloudMatch ? parseIsoMs(cloudMatch.updatedAt) : 0;
        const needsPush =
          !cloudMatch ||
          options?.forcePushLocalToCloud ||
          localMs > cloudMs ||
          (localAd.status !== cloudMatch.status && localMs >= cloudMs) ||
          (localAd.impressions || 0) > (cloudMatch.impressions || 0) ||
          (localAd.clicks || 0) > (cloudMatch.clicks || 0);
        if (needsPush) {
          pushTasks.push(upsertCloudPublicAd(localAd));
        }
      }

      // Movies: push any local movie missing in cloud or newer than cloud
      const cloudMoviesById = new Map(cloudMovies.map((m) => [m.id, m]));
      for (const localMovie of localMovies) {
        const cloudMatch = cloudMoviesById.get(localMovie.id);
        if (
          !cloudMatch ||
          options?.forcePushLocalToCloud ||
          parseIsoMs(localMovie.updatedAt) > parseIsoMs(cloudMatch.updatedAt)
        ) {
          pushTasks.push(upsertCloudMovie(localMovie));
        }
      }

      // Series: push any local series missing in cloud or newer than cloud
      const cloudSeriesById = new Map(cloudSeries.map((s) => [s.id, s]));
      for (const localSer of localSeries) {
        const cloudMatch = cloudSeriesById.get(localSer.id);
        if (
          !cloudMatch ||
          options?.forcePushLocalToCloud ||
          parseIsoMs(localSer.updatedAt) > parseIsoMs(cloudMatch.updatedAt)
        ) {
          pushTasks.push(upsertCloudSeries(localSer));
        }
      }

      // Catalog lists: NEVER overwrite non-empty cloud list with an empty local list!
      if (cloudBanners === null ? localBanners.length > 0 : options?.forcePushLocalToCloud && localBanners.length > 0) {
        pushTasks.push(upsertCloudCatalogList('banners', localBanners));
      }
      if (
        cloudHighlights === null
          ? localHighlights.length > 0
          : options?.forcePushLocalToCloud && localHighlights.length > 0
      ) {
        pushTasks.push(upsertCloudCatalogList('highlights', localHighlights));
      }
      if (
        cloudCategories === null
          ? localCategories.length > 0
          : options?.forcePushLocalToCloud && localCategories.length > 0
      ) {
        pushTasks.push(upsertCloudCatalogList('categories', localCategories));
      }
      if (cloudGenres === null ? localGenres.length > 0 : options?.forcePushLocalToCloud && localGenres.length > 0) {
        pushTasks.push(upsertCloudCatalogList('genres', localGenres));
      }
      if (
        cloudServers === null ? localServers.length > 0 : options?.forcePushLocalToCloud && localServers.length > 0
      ) {
        pushTasks.push(upsertCloudCatalogList('servers', localServers));
      }

      if (pushTasks.length > 0) {
        await Promise.allSettled(pushTasks);
        summary.pushedToCloud = true;
      }
    }

    summary.counts.ads = Math.max(cloudAds.length, localAds.length);
    summary.counts.movies = Math.max(cloudMovies.length, localMovies.length);
    summary.counts.series = Math.max(cloudSeries.length, localSeries.length);
    summary.counts.banners = Math.max((cloudBanners || []).length, localBanners.length);
    summary.counts.highlights = Math.max((cloudHighlights || []).length, localHighlights.length);
    summary.counts.categories = Math.max((cloudCategories || []).length, localCategories.length);
    summary.counts.genres = Math.max((cloudGenres || []).length, localGenres.length);
    summary.counts.servers = Math.max((cloudServers || []).length, localServers.length);

    return summary;
  };

  if (options?.forcePushLocalToCloud) {
    return run();
  }

  inFlightReconcile = run().finally(() => {
    inFlightReconcile = null;
  });
  return inFlightReconcile;
}
