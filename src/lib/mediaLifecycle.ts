/**
 * Media lifecycle & Picture-in-Picture helpers for MOVIX.
 * - Keeps OS media notification cards cleared so lockscreen/shade media controls
 *   never linger outside the app.
 * - Detects active native Picture-in-Picture (Standard, WebKit Safari, and Document PiP)
 *   so background audio is strictly blocked on app exit unless native PiP is active.
 */

export interface WebKitVideoElement extends HTMLVideoElement {
  webkitSupportsPresentationMode?: (mode: 'inline' | 'fullscreen' | 'picture-in-picture') => boolean;
  webkitSetPresentationMode?: (mode: 'inline' | 'fullscreen' | 'picture-in-picture') => void;
  webkitPresentationMode?: 'inline' | 'fullscreen' | 'picture-in-picture';
  autoPictureInPicture?: boolean;
}

export interface DocumentPictureInPictureApi {
  requestWindow: (options?: { width?: number; height?: number; disallowReturnToOpener?: boolean }) => Promise<Window>;
  window: Window | null;
}

const CLEARABLE_MEDIA_ACTIONS: MediaSessionAction[] = [
  'play',
  'pause',
  'stop',
  'seekbackward',
  'seekforward',
  'seekto',
  'previoustrack',
  'nexttrack',
];

/**
 * Clears OS Media Session metadata, state, and action handlers so Chrome/Android/iOS
 * does not display or retain a system notification media card outside the app.
 */
export function clearOsMediaSession(): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
    for (const action of CLEARABLE_MEDIA_ACTIONS) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {
        // Ignore unsupported MediaSession actions
      }
    }
  } catch {
    // Ignore restricted MediaSession environments
  }
}

/**
 * Returns true if the user is actively watching in a native OS-level Picture-in-Picture window.
 */
export function isElementInNativePip(
  video: HTMLVideoElement | null,
  docPipWindow?: Window | null
): boolean {
  if (typeof document !== 'undefined' && Boolean(document.pictureInPictureElement)) {
    return true;
  }
  const wkVideo = video as WebKitVideoElement | null;
  if (wkVideo?.webkitPresentationMode === 'picture-in-picture') {
    return true;
  }
  if (docPipWindow && !docPipWindow.closed) {
    return true;
  }
  return false;
}

/**
 * Returns the Document Picture-in-Picture API if supported by the current browser.
 */
export function getDocumentPictureInPicture(): DocumentPictureInPictureApi | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { documentPictureInPicture?: DocumentPictureInPictureApi })
    .documentPictureInPicture;
  if (candidate && typeof candidate.requestWindow === 'function') {
    return candidate;
  }
  return null;
}

/**
 * Sends a playback command to a YouTube iframe initialized with enablejsapi=1.
 */
export function sendYouTubeCommand(
  iframe: HTMLIFrameElement | null,
  func: 'pauseVideo' | 'playVideo' | 'mute' | 'unMute'
): void {
  if (!iframe?.contentWindow) return;
  try {
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func, args: [] }),
      '*'
    );
  } catch {
    // Ignore cross-origin postMessage errors
  }
}

let globalAudioGuardInstalled = false;

/**
 * Installs a single page-level safety net ensuring NO <video> or <audio> element
 * can continue playing sound when the user leaves MOVIX unless native OS PiP is active.
 */
export function installGlobalInAppAudioGuard(): void {
  if (globalAudioGuardInstalled || typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }
  globalAudioGuardInstalled = true;

  const silenceNonPipMedia = () => {
    const pipEl = document.pictureInPictureElement;
    let anyNativePip = Boolean(pipEl);

    const mediaNodes = document.querySelectorAll<HTMLMediaElement>('video, audio');
    mediaNodes.forEach((node) => {
      const isNodePip =
        node === pipEl ||
        (node as WebKitVideoElement).webkitPresentationMode === 'picture-in-picture';
      if (isNodePip) {
        anyNativePip = true;
        return;
      }
      if (!node.paused) {
        try {
          node.pause();
        } catch {
          // Ignore pause errors
        }
      }
      try {
        node.muted = true;
      } catch {
        // Ignore mute errors
      }
    });

    if (!anyNativePip) {
      clearOsMediaSession();
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      silenceNonPipMedia();
    }
  });
  document.addEventListener('freeze', silenceNonPipMedia);
  window.addEventListener('pagehide', silenceNonPipMedia);
}

installGlobalInAppAudioGuard();

