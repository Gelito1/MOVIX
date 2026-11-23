// Supabase Edge Function: send-movix-push
// Dispatches rich Web Push Notifications via Firebase Cloud Messaging HTTP v1 API
// Requires Secrets: FIREBASE_SERVICE_ACCOUNT_JSON, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type PushCategory =
  | 'welcome'
  | 'new_movies'
  | 'new_seasons'
  | 'app_updates'
  | 'recommendations';

interface SendPushRequest {
  title: string;
  body: string;
  image_url?: string;
  target_url?: string;
  category: PushCategory;
  target_token?: string;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

const VALID_CATEGORIES = new Set<PushCategory>([
  'welcome',
  'new_movies',
  'new_seasons',
  'app_updates',
  'recommendations',
]);

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/\\n/g, '\n')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getGoogleAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );

  const signingInput = `${header}.${payload}`;
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const assertion = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) {
    throw new Error(`OAuth2 token exchange failed (${res.status})`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Missing access_token from Google OAuth2');
  }
  return data.access_token;
}

function sanitizeTargetUrl(raw?: string): string {
  const trimmed = (raw || '').trim().slice(0, 500);
  if (!trimmed) return '#/';
  if ((trimmed.startsWith('#/') || trimmed.startsWith('/')) && !trimmed.startsWith('//')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') return parsed.toString();
  } catch {
    // ignore
  }
  return '#/';
}

function sanitizeImageUrl(raw?: string): string {
  const trimmed = (raw || '').trim().slice(0, 500);
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') return parsed.toString();
  } catch {
    // ignore
  }
  return '';
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const saRaw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!saRaw || !supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Missing required server secrets.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const sa = JSON.parse(saRaw) as ServiceAccount;
    const body = (await req.json()) as SendPushRequest;

    const title = (body.title || '').trim().slice(0, 120);
    const messageBody = (body.body || '').trim().slice(0, 320);
    const imageUrl = sanitizeImageUrl(body.image_url);
    const targetUrl = sanitizeTargetUrl(body.target_url);
    const category: PushCategory = VALID_CATEGORIES.has(body.category)
      ? body.category
      : 'new_movies';

    if (!title || !messageBody) {
      return new Response(
        JSON.stringify({ error: 'title and body are required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    let query = supabase.from('push_subscriptions').select('id, fcm_token, prefs');
    if (body.target_token) {
      query = query.eq('fcm_token', body.target_token);
    } else if (category !== 'welcome') {
      query = query.eq(`prefs->>${category}`, 'true');
    }

    const { data: subscribers, error: queryError } = await query;
    if (queryError) {
      throw queryError;
    }

    const targets = subscribers || [];
    const accessToken = await getGoogleAccessToken(sa);
    const fcmEndpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`;

    let successCount = 0;
    let failureCount = 0;
    const expiredTokens: string[] = [];

    for (const sub of targets) {
      const fcmRes = await fetch(fcmEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: sub.fcm_token,
            notification: {
              title,
              body: messageBody,
              ...(imageUrl ? { image: imageUrl } : {}),
            },
            webpush: {
              headers: { Urgency: 'high' },
              notification: {
                title,
                body: messageBody,
                icon: '/pwa-192x192.png',
                badge: '/pwa-192x192.png',
                ...(imageUrl ? { image: imageUrl } : {}),
              },
              fcm_options: { link: targetUrl },
            },
            data: {
              title,
              body: messageBody,
              image_url: imageUrl,
              target_url: targetUrl,
              category,
            },
          },
        }),
      });

      if (fcmRes.ok) {
        successCount++;
      } else {
        failureCount++;
        const errPayload = await fcmRes.json().catch(() => ({}));
        const errCode =
          errPayload?.error?.details?.find((d: { errorCode?: string }) => d.errorCode)?.errorCode ||
          errPayload?.error?.status ||
          '';
        if (
          fcmRes.status === 404 ||
          errCode === 'UNREGISTERED' ||
          errCode === 'INVALID_ARGUMENT' ||
          errCode === 'SENDER_ID_MISMATCH'
        ) {
          expiredTokens.push(sub.fcm_token);
        }
      }
    }

    // Automatically purge invalid or expired tokens
    if (expiredTokens.length > 0) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .in('fcm_token', expiredTokens);
    }

    // Record campaign delivery metrics
    await supabase.from('push_notification_history').insert({
      title,
      body: messageBody,
      image_url: imageUrl,
      target_url: targetUrl,
      category,
      status: successCount > 0 || targets.length === 0 ? 'sent' : 'failed',
      sent_at: new Date().toISOString(),
      targeted_count: targets.length,
      success_count: successCount,
      failure_count: failureCount,
      cleaned_tokens_count: expiredTokens.length,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        targeted_count: targets.length,
        success_count: successCount,
        failure_count: failureCount,
        cleaned_tokens_count: expiredTokens.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Internal push dispatch error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
