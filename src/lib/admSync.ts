const ADM_SYNC_EVENT = 'movix:adm-synced';
const ADM_SYNC_CHANNEL = 'movix-adm-sync';

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (!channel) {
    try {
      channel = new BroadcastChannel(ADM_SYNC_CHANNEL);
    } catch {
      return null;
    }
  }
  return channel;
}

/**
 * Emits a live synchronization signal across both the current tab and any other
 * open MOVIX tabs so catalog, banners, ads, and site settings refresh immediately.
 */
export function emitAdmDataSync(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new Event(ADM_SYNC_EVENT));
  } catch {
    // ignore
  }
  try {
    getChannel()?.postMessage({ type: ADM_SYNC_EVENT, ts: Date.now() });
  } catch {
    // ignore
  }
}

export function subscribeAdmDataSync(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const onWindowEvent = () => listener();
  window.addEventListener(ADM_SYNC_EVENT, onWindowEvent);

  const bc = getChannel();
  const onChannelMsg = (ev: MessageEvent) => {
    if (ev?.data?.type === ADM_SYNC_EVENT) {
      listener();
    }
  };
  bc?.addEventListener('message', onChannelMsg);

  return () => {
    window.removeEventListener(ADM_SYNC_EVENT, onWindowEvent);
    bc?.removeEventListener('message', onChannelMsg);
  };
}
