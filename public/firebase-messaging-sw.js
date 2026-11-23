/* global importScripts, firebase, self, clients */

// Activate immediately so showNotification() works without delay across all browsers
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function sanitizeNotificationTargetUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '/';
  const trimmed = rawUrl.trim();
  if ((trimmed.startsWith('#/') || trimmed.startsWith('/')) && !trimmed.startsWith('//')) {
    return trimmed.startsWith('#/') ? '/' + trimmed : trimmed;
  }
  try {
    const parsed = new URL(trimmed, self.location.origin);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // fallback safely
  }
  return '/';
}

/**
 * Progressive cross-browser showNotification helper:
 * Tries full rich options first (Chrome/Edge/Android/Samsung/Opera),
 * then gracefully falls back to minimal options (Safari/Firefox/WebKit)
 * so unsupported fields like vibrate/renotify/image/badge never break delivery.
 */
function showSafeNotification(title, params) {
  const safeTitle = title || 'MOVIX';
  const body =
    (params && params.body) ||
    'Notificações ativadas! Vai receber avisos de novos filmes e séries.';
  const targetUrl = sanitizeNotificationTargetUrl(params && params.targetUrl);
  const tag = (params && params.tag) || 'movix-push';
  const category = (params && params.category) || 'new_movies';

  const richOptions = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-badge-96x96.png',
    ...(params && params.image ? { image: params.image } : {}),
    vibrate: [140, 70, 140],
    silent: false,
    tag,
    renotify: true,
    timestamp: Date.now(),
    data: {
      target_url: targetUrl,
      category,
    },
  };

  const minimalOptions = {
    body,
    icon: '/pwa-192x192.png',
    tag,
    data: {
      target_url: targetUrl,
      category,
    },
  };

  return self.registration
    .showNotification(safeTitle, richOptions)
    .catch(() => self.registration.showNotification(safeTitle, minimalOptions))
    .catch(() => self.registration.showNotification(safeTitle, { body }));
}

let fcmInitialized = false;

try {
  importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

  firebase.initializeApp({
    apiKey: 'AIzaSyCA1H88oadDN3cR-_b2nnaJna-DhFsJZak',
    authDomain: 'movix-e3099.firebaseapp.com',
    projectId: 'movix-e3099',
    storageBucket: 'movix-e3099.firebasestorage.app',
    messagingSenderId: '430603543344',
    appId: '1:430603543344:web:54b07b1c1b20263110def5',
    measurementId: 'G-P0Y6ZZQ92P',
  });

  const messaging = firebase.messaging();
  fcmInitialized = true;

  messaging.onBackgroundMessage((payload) => {
    const notification = (payload && payload.notification) || {};
    const data = (payload && payload.data) || {};

    const title = notification.title || data.title || 'MOVIX';
    const body =
      notification.body ||
      data.body ||
      'Notificações ativadas! Vai receber avisos de novos filmes e séries.';
    const image = notification.image || data.image_url || undefined;
    const targetUrl =
      data.target_url || (payload && payload.fcmOptions && payload.fcmOptions.link) || '/';
    const category = data.category || 'new_movies';

    return showSafeNotification(title, {
      body,
      image,
      targetUrl,
      category,
      tag: data.campaign_id ? `movix-${data.campaign_id}` : `movix-${category}`,
    });
  });
} catch {
  // Browsers blocking third-party scripts (e.g. Brave Shields, Firefox Strict, offline)
  // still activate this SW cleanly and use the standard Web Push fallback below.
  fcmInitialized = false;
}

// Standard Web Push fallback when Firebase Messaging compat is unavailable
self.addEventListener('push', (event) => {
  if (fcmInitialized) return;
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const notification = payload.notification || {};
  const data = payload.data || {};
  const title = notification.title || data.title || payload.title || 'MOVIX';
  const body =
    notification.body ||
    data.body ||
    payload.body ||
    'Nova atualização disponível no MOVIX.';
  const image = notification.image || data.image_url || payload.image || undefined;
  const targetUrl = data.target_url || payload.target_url || '/';
  const category = data.category || payload.category || 'new_movies';

  event.waitUntil(
    showSafeNotification(title, {
      body,
      image,
      targetUrl,
      category,
      tag: data.campaign_id ? `movix-${data.campaign_id}` : `movix-${category}`,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = sanitizeNotificationTargetUrl(
    event.notification && event.notification.data && event.notification.data.target_url
  );
  const fullUrl = new URL(targetUrl, self.location.origin).toString();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          try {
            client.postMessage({ type: 'MOVIX_PUSH_NAVIGATE', targetUrl });
          } catch {
            // ignore
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(fullUrl);
      }
      return undefined;
    })
  );
});
