import crypto from 'crypto';
import { getAdmStore, refreshAdStatuses, saveAdmStore } from './admStore.ts';
import { getParsedFirebaseServiceAccount } from './config.ts';
import {
  createPushCampaign,
  listPushCampaigns,
  listPushSubscriptions,
  markPushWelcomeSent,
  recordApiError,
  removeInvalidPushTokens,
  updatePushCampaign,
  type PushCampaignRecord,
  type PushCategory,
  type PushSubscriptionRecord,
} from './store.ts';

const VALID_CATEGORIES = new Set<PushCategory>([
  'welcome',
  'new_movies',
  'new_seasons',
  'app_updates',
  'recommendations',
]);

let cachedAccessToken: { token: string; expiresAt: number; projectId: string } | null = null;

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function sanitizePushCategory(raw: unknown): PushCategory {
  if (typeof raw === 'string' && VALID_CATEGORIES.has(raw as PushCategory)) {
    return raw as PushCategory;
  }
  return 'new_movies';
}

export function sanitizeTargetUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '#/';
  const trimmed = raw.trim().slice(0, 500);
  if (!trimmed) return '#/';
  if (trimmed.startsWith('#/') || trimmed.startsWith('/')) {
    // Prevent protocol-relative open redirect (//evil.com)
    if (trimmed.startsWith('//')) return '#/';
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    // Fall back safely
  }
  return '#/';
}

export function sanitizeImageUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().slice(0, 500);
  if (!trimmed) return '';
  // Allow safe internal uploaded media paths (/api/media/...)
  if (trimmed.startsWith('/api/media/') && !trimmed.includes('..') && !trimmed.startsWith('//')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return '';
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.')
    ) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function resolveAbsoluteHttpsImage(imageUrl: string): string {
  if (!imageUrl) return '';
  if (imageUrl.startsWith('https://')) return imageUrl;
  if (imageUrl.startsWith('/')) {
    const base = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
    if (base.startsWith('https://')) {
      return `${base}${imageUrl}`;
    }
  }
  return '';
}

async function getFcmAccessToken(): Promise<{ accessToken: string; projectId: string }> {
  const sa = getParsedFirebaseServiceAccount();
  if (!sa) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON_NOT_CONFIGURED');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (
    cachedAccessToken &&
    cachedAccessToken.projectId === sa.project_id &&
    cachedAccessToken.expiresAt > Date.now() + 60_000
  ) {
    return { accessToken: cachedAccessToken.token, projectId: sa.project_id };
  }

  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = base64UrlEncode(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      exp: nowSec + 3600,
      iat: nowSec,
    })
  );

  const signingInput = `${header}.${claimSet}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64UrlEncode(signer.sign(sa.private_key));
  const assertion = `${signingInput}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '');
    recordApiError('Sistema', 'oauth2.googleapis.com/token', tokenRes.status, errText.slice(0, 240));
    throw new Error(`Falha ao autenticar conta de serviço Firebase (${tokenRes.status}).`);
  }

  const json = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error('Token OAuth2 não retornado pelo Google.');
  }

  cachedAccessToken = {
    token: json.access_token,
    projectId: sa.project_id,
    expiresAt: Date.now() + Math.max(300, (json.expires_in || 3600) - 120) * 1000,
  };

  return { accessToken: json.access_token, projectId: sa.project_id };
}

function isTokenInvalidError(errorCode: string, httpStatus: number): boolean {
  if (httpStatus === 404) return true;
  return (
    errorCode === 'UNREGISTERED' ||
    errorCode === 'INVALID_ARGUMENT' ||
    errorCode === 'SENDER_ID_MISMATCH' ||
    errorCode === 'NOT_FOUND'
  );
}

export interface DispatchPushInput {
  campaignId?: string;
  title: string;
  body: string;
  image_url?: string;
  target_url?: string;
  category: PushCategory;
  targetToken?: string;
}

export interface DispatchPushResult {
  fcmConfigured: boolean;
  targetedCount: number;
  successCount: number;
  failureCount: number;
  cleanedTokensCount: number;
  note?: string;
}

export interface UniversalPushEvent {
  campaignId: string;
  title: string;
  body: string;
  image_url: string;
  target_url: string;
  category: PushCategory;
  createdAt: string;
  targetToken?: string;
}

interface SsePushClient {
  id: string;
  token: string;
  write: (chunk: string) => void;
}

const sseClients = new Map<string, SsePushClient>();
const recentBroadcasts: UniversalPushEvent[] = [];
const MAX_RECENT_BROADCASTS = 25;

export function registerPushSseClient(
  token: string,
  write: (chunk: string) => void
): () => void {
  const id = `sse_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  sseClients.set(id, { id, token, write });
  return () => {
    sseClients.delete(id);
  };
}

export function broadcastConfigSyncEvent(): void {
  const chunk = `event: config_sync\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`;
  for (const [id, client] of sseClients.entries()) {
    try {
      client.write(chunk);
    } catch {
      sseClients.delete(id);
    }
  }
}

export function getRecentBroadcastsSince(
  sinceMs: number,
  token?: string
): UniversalPushEvent[] {
  const sub = token ? listPushSubscriptions().find((s) => s.fcm_token === token) : undefined;
  return recentBroadcasts.filter((ev) => {
    const evTime = Date.parse(ev.createdAt);
    if (Number.isFinite(sinceMs) && sinceMs > 0 && evTime <= sinceMs) return false;
    if (ev.targetToken && ev.targetToken !== token) return false;
    if (ev.category !== 'welcome' && sub && !sub.prefs[ev.category]) return false;
    return true;
  });
}

function broadcastToUniversalSseClients(
  event: UniversalPushEvent,
  eligibleTokens: Set<string>
): Set<string> {
  if (!event.targetToken) {
    recentBroadcasts.push(event);
    if (recentBroadcasts.length > MAX_RECENT_BROADCASTS) {
      recentBroadcasts.splice(0, recentBroadcasts.length - MAX_RECENT_BROADCASTS);
    }
  }

  const deliveredTokens = new Set<string>();
  const payloadStr = `event: notification\ndata: ${JSON.stringify({
    campaignId: event.campaignId,
    title: event.title,
    body: event.body,
    image_url: event.image_url,
    target_url: event.target_url,
    category: event.category,
    createdAt: event.createdAt,
  })}\n\n`;

  for (const [id, client] of sseClients.entries()) {
    if (event.targetToken && client.token !== event.targetToken) continue;
    if (!event.targetToken && eligibleTokens.size > 0 && !eligibleTokens.has(client.token)) {
      // Allow newly connected universal browser clients even if not yet indexed
      const sub = listPushSubscriptions().find((s) => s.fcm_token === client.token);
      if (sub && event.category !== 'welcome' && !sub.prefs[event.category]) {
        continue;
      }
    }
    try {
      client.write(payloadStr);
      deliveredTokens.add(client.token);
    } catch {
      sseClients.delete(id);
    }
  }
  return deliveredTokens;
}

function isRealFcmToken(token: string): boolean {
  return Boolean(token) && !token.startsWith('local-web-') && !token.startsWith('web-universal-');
}

function filterSubscribersForCategory(
  subscribers: PushSubscriptionRecord[],
  category: PushCategory,
  targetToken?: string
): PushSubscriptionRecord[] {
  if (targetToken) {
    return subscribers.filter((s) => s.fcm_token === targetToken);
  }
  if (category === 'welcome') {
    return subscribers;
  }
  return subscribers.filter((sub) => Boolean(sub.prefs[category]));
}

export async function dispatchFcmMessages(input: DispatchPushInput): Promise<DispatchPushResult> {
  const campaignId =
    input.campaignId || `cmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const title = input.title.trim().slice(0, 120);
  const body = input.body.trim().slice(0, 320);
  const imageUrl = sanitizeImageUrl(input.image_url);
  const targetUrl = sanitizeTargetUrl(input.target_url);
  const category = sanitizePushCategory(input.category);

  const recipients = filterSubscribersForCategory(
    listPushSubscriptions(),
    category,
    input.targetToken
  );

  const eligibleTokenSet = new Set(recipients.map((r) => r.fcm_token));

  // 1. Always deliver in real time to ALL connected browsers via Universal SSE Hub
  //    (Safari, Firefox, Brave, Opera, Samsung Internet, Edge, Chrome, WebView)
  const sseDeliveredTokens = broadcastToUniversalSseClients(
    {
      campaignId,
      title,
      body,
      image_url: imageUrl,
      target_url: targetUrl,
      category,
      createdAt: new Date().toISOString(),
      targetToken: input.targetToken,
    },
    eligibleTokenSet
  );

  if (recipients.length === 0 && sseDeliveredTokens.size === 0) {
    return {
      fcmConfigured: Boolean(getParsedFirebaseServiceAccount()),
      targetedCount: 0,
      successCount: 0,
      failureCount: 0,
      cleanedTokensCount: 0,
      note: 'Nenhum dispositivo inscrito para esta categoria.',
    };
  }

  const realFcmRecipients = recipients.filter((sub) => isRealFcmToken(sub.fcm_token));
  const universalOnlyRecipients = recipients.filter((sub) => !isRealFcmToken(sub.fcm_token));

  let auth: { accessToken: string; projectId: string } | null = null;
  let fcmErrorNote: string | undefined;
  if (realFcmRecipients.length > 0) {
    try {
      auth = await getFcmAccessToken();
    } catch (err) {
      const isNotConfigured =
        err instanceof Error && err.message === 'FIREBASE_SERVICE_ACCOUNT_JSON_NOT_CONFIGURED';
      fcmErrorNote = isNotConfigured
        ? 'Enviado via canal Web universal (configure FIREBASE_SERVICE_ACCOUNT_JSON para push FCM em segundo plano).'
        : err instanceof Error
          ? err.message
          : 'Erro de autenticação FCM.';
    }
  }

  const invalidTokens: string[] = [];
  const fcmSucceededTokens = new Set<string>();
  let fcmFailedCount = 0;

  if (auth && realFcmRecipients.length > 0) {
    const fcmImageUrl = resolveAbsoluteHttpsImage(imageUrl);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(auth.projectId)}/messages:send`;
    const CHUNK_SIZE = 15;
    for (let i = 0; i < realFcmRecipients.length; i += CHUNK_SIZE) {
      const chunk = realFcmRecipients.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (sub) => {
          try {
            const messagePayload: Record<string, unknown> = {
              token: sub.fcm_token,
              notification: {
                title,
                body,
                ...(fcmImageUrl ? { image: fcmImageUrl } : {}),
              },
              webpush: {
                headers: {
                  Urgency: 'high',
                },
                notification: {
                  title,
                  body,
                  icon: '/pwa-192x192.png',
                  badge: '/pwa-badge-96x96.png',
                  ...(fcmImageUrl ? { image: fcmImageUrl } : {}),
                  vibrate: [140, 70, 140],
                  silent: false,
                  tag: `movix-${campaignId}`,
                  renotify: true,
                },
                fcm_options: {
                  link: targetUrl,
                },
              },
              data: {
                campaign_id: campaignId,
                title,
                body,
                image_url: fcmImageUrl || imageUrl,
                target_url: targetUrl,
                category,
              },
            };

            const res = await fetch(endpoint, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${auth!.accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ message: messagePayload }),
            });

            if (res.ok) {
              fcmSucceededTokens.add(sub.fcm_token);
            } else {
              if (!sseDeliveredTokens.has(sub.fcm_token)) {
                fcmFailedCount++;
              }
              const errJson = (await res.json().catch(() => ({}))) as {
                error?: {
                  status?: string;
                  details?: Array<{ errorCode?: string }>;
                };
              };
              const fcmErrCode =
                errJson.error?.details?.find((d) => d.errorCode)?.errorCode ||
                errJson.error?.status ||
                '';
              if (isTokenInvalidError(fcmErrCode, res.status)) {
                invalidTokens.push(sub.fcm_token);
              }
            }
          } catch {
            if (!sseDeliveredTokens.has(sub.fcm_token)) {
              fcmFailedCount++;
            }
          }
        })
      );
    }
  } else if (realFcmRecipients.length > 0) {
    for (const sub of realFcmRecipients) {
      if (!sseDeliveredTokens.has(sub.fcm_token)) {
        fcmFailedCount++;
      }
    }
  }

  // Count universal browsers that are subscribed (queued in broadcast replay or live via SSE)
  const combinedSuccessTokens = new Set<string>([...fcmSucceededTokens, ...sseDeliveredTokens]);
  for (const sub of universalOnlyRecipients) {
    if (!input.targetToken) {
      // Queued in recentBroadcasts replay buffer for universal browser delivery
      combinedSuccessTokens.add(sub.fcm_token);
    }
  }

  const targetedCount = Math.max(recipients.length, combinedSuccessTokens.size);
  const successCount = combinedSuccessTokens.size;
  const failureCount = Math.max(0, fcmFailedCount);
  const cleanedTokensCount = removeInvalidPushTokens(invalidTokens);

  const notes: string[] = [];
  if (fcmErrorNote) notes.push(fcmErrorNote);
  if (cleanedTokensCount > 0) {
    notes.push(`${cleanedTokensCount} token(s) expirado(s) removido(s) automaticamente.`);
  }

  return {
    fcmConfigured: Boolean(getParsedFirebaseServiceAccount()),
    targetedCount,
    successCount,
    failureCount,
    cleanedTokensCount,
    note: notes.length > 0 ? notes.join(' ') : undefined,
  };
}

export const WELCOME_PUSH_PAYLOAD = {
  title: 'Bem-vindo ao MOVIX 🎬',
  body: 'Notificações ativadas! Vai receber avisos de novos filmes e séries.',
  image_url: '',
  target_url: '#/',
  category: 'welcome' as PushCategory,
};

export async function dispatchWelcomePushIfNeeded(record: PushSubscriptionRecord): Promise<{
  welcomeTriggered: boolean;
  fcmSent: boolean;
  payload: typeof WELCOME_PUSH_PAYLOAD;
}> {
  if (record.welcome_sent) {
    return { welcomeTriggered: false, fcmSent: false, payload: WELCOME_PUSH_PAYLOAD };
  }

  // Mark welcome_sent = true immediately to prevent duplicate welcomes on concurrent tabs
  markPushWelcomeSent(record.fcm_token);

  const res = await dispatchFcmMessages({
    ...WELCOME_PUSH_PAYLOAD,
    targetToken: record.fcm_token,
  });

  if (res.successCount > 0) {
    createPushCampaign({
      id: `cmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      ...WELCOME_PUSH_PAYLOAD,
      status: 'sent',
      scheduled_for: null,
      sent_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      targeted_count: 1,
      success_count: res.successCount,
      failure_count: res.failureCount,
      cleaned_tokens_count: res.cleanedTokensCount,
      note: 'Boas-vindas automático',
    });
  }

  return {
    welcomeTriggered: true,
    fcmSent: res.successCount > 0,
    payload: WELCOME_PUSH_PAYLOAD,
  };
}

export async function sendOrScheduleAdminCampaign(params: {
  title: string;
  body: string;
  image_url?: string;
  target_url?: string;
  category: PushCategory;
  scheduled_for?: string | null;
}): Promise<PushCampaignRecord> {
  const title = params.title.trim().slice(0, 120);
  const body = params.body.trim().slice(0, 320);
  const image_url = sanitizeImageUrl(params.image_url);
  const target_url = sanitizeTargetUrl(params.target_url);
  const category = sanitizePushCategory(params.category);
  const nowIso = new Date().toISOString();

  // Handle scheduled future dispatch
  if (params.scheduled_for) {
    const scheduledTime = Date.parse(params.scheduled_for);
    if (Number.isFinite(scheduledTime) && scheduledTime > Date.now() + 10_000) {
      const targeted = filterSubscribersForCategory(listPushSubscriptions(), category).length;
      return createPushCampaign({
        id: `cmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        title,
        body,
        image_url,
        target_url,
        category,
        status: 'scheduled',
        scheduled_for: new Date(scheduledTime).toISOString(),
        sent_at: null,
        created_at: nowIso,
        targeted_count: targeted,
        success_count: 0,
        failure_count: 0,
        cleaned_tokens_count: 0,
      });
    }
  }

  const result = await dispatchFcmMessages({
    title,
    body,
    image_url,
    target_url,
    category,
  });

  const status: PushCampaignRecord['status'] =
    result.successCount > 0 || result.targetedCount === 0 ? 'sent' : 'failed';

  return createPushCampaign({
    id: `cmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    body,
    image_url,
    target_url,
    category,
    status,
    scheduled_for: null,
    sent_at: new Date().toISOString(),
    created_at: nowIso,
    targeted_count: result.targetedCount,
    success_count: result.successCount,
    failure_count: result.failureCount,
    cleaned_tokens_count: result.cleanedTokensCount,
    note: result.note,
  });
}

export function getPushOverviewStats() {
  const subs = listPushSubscriptions();
  const campaigns = listPushCampaigns();
  const fcmSa = getParsedFirebaseServiceAccount();

  return {
    fcmConfigured: Boolean(fcmSa),
    fcmProjectId: fcmSa?.project_id || 'movix-e3099',
    totalSubscribers: subs.length,
    realFcmTokens: subs.filter((s) => isRealFcmToken(s.fcm_token)).length,
    categoryCounts: {
      new_movies: subs.filter((s) => s.prefs.new_movies).length,
      new_seasons: subs.filter((s) => s.prefs.new_seasons).length,
      app_updates: subs.filter((s) => s.prefs.app_updates).length,
      recommendations: subs.filter((s) => s.prefs.recommendations).length,
    },
    campaigns,
  };
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

export function startPushScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(async () => {
    const now = Date.now();
    const dueCampaigns = listPushCampaigns().filter(
      (c) =>
        c.status === 'scheduled' &&
        c.scheduled_for !== null &&
        Date.parse(c.scheduled_for) <= now
    );

    for (const campaign of dueCampaigns) {
      try {
        const res = await dispatchFcmMessages({
          title: campaign.title,
          body: campaign.body,
          image_url: campaign.image_url,
          target_url: campaign.target_url,
          category: campaign.category,
        });
        updatePushCampaign(campaign.id, {
          status: res.successCount > 0 || res.targetedCount === 0 ? 'sent' : 'failed',
          sent_at: new Date().toISOString(),
          targeted_count: res.targetedCount,
          success_count: res.successCount,
          failure_count: res.failureCount,
          cleaned_tokens_count: res.cleanedTokensCount,
          note: res.note || 'Disparo agendado concluído',
        });
      } catch (err) {
        updatePushCampaign(campaign.id, {
          status: 'failed',
          sent_at: new Date().toISOString(),
          note: err instanceof Error ? err.message : 'Erro ao enviar agendamento',
        });
      }
    }
    // Also notify users when any scheduled MOVIX ADS campaign automatically becomes active
    try {
      const admStore = getAdmStore();
      const previouslyScheduledIds = new Set(
        admStore.ads.filter((a) => a.status === 'scheduled').map((a) => a.id)
      );
      if (previouslyScheduledIds.size > 0) {
        refreshAdStatuses();
        const newlyActive = admStore.ads.filter(
          (a) => previouslyScheduledIds.has(a.id) && a.status === 'active' && !a.notifiedAt
        );
        for (const ad of newlyActive) {
          ad.notifiedAt = new Date().toISOString();
          saveAdmStore();
          broadcastConfigSyncEvent();
          const notifTitle = (ad.title || ad.name || 'Novidade em destaque no MOVIX').trim().slice(0, 120);
          const notifBody =
            (ad.description || '').trim().slice(0, 320) ||
            (ad.ctaText
              ? `${ad.ctaText} — Confira agora no MOVIX!`
              : 'Confira esta novidade em destaque agora no MOVIX!');
          const targetUrl =
            ad.destinationUrl && ad.destinationUrl.startsWith('https://')
              ? ad.destinationUrl
              : ad.placements.includes('categories_page')
                ? '#/filmes'
                : '#/';
          await sendOrScheduleAdminCampaign({
            title: notifTitle,
            body: notifBody,
            image_url: ad.imageUrl || '',
            target_url: targetUrl,
            category: 'recommendations',
          }).catch(() => {});
        }
      }
    } catch {
      // ignore scheduler error
    }
  }, 15_000);
}
