/**
 * Zero-Notification In-App Web Audio Engine for MOVIX Ad Videos.
 *
 * Why Web Audio (`AudioContext` + `AudioBufferSourceNode`) instead of unmuting `<video>`:
 * - Android Chrome ALWAYS creates an OS Media Controls notification card (title, URL,
 *   timeline scrubber, play/pause) for ANY unmuted `<video>` longer than 5 seconds —
 *   even when `navigator.mediaSession.metadata = null`.
 * - By keeping the `<video>` element PERMANENTLY muted (`muted = true`, `volume = 0`)
 *   and decoding + playing its real audio track exclusively through Web Audio API,
 *   ad videos play with full crisp sound inside MOVIX while Android / Chrome NEVER
 *   creates a notification-shade media player.
 * - Immediately stops and suspends Web Audio on `visibilitychange` (hidden), `pagehide`,
 *   or `freeze` so audio NEVER leaks outside the app.
 */

import { clearOsMediaSession } from './mediaLifecycle';

const MAX_DECODE_BYTES = 35 * 1024 * 1024;
const MAX_CACHED_BUFFERS = 6;

interface AdAudioController {
  video: HTMLVideoElement;
  isPlayerOverlay: boolean;
  stopSound: () => void;
  silenceForUserAction: () => void;
  setMuted: (muted: boolean) => void;
  resumeIfEligible: () => void;
}

const controllerByVideo = new WeakMap<HTMLVideoElement, AdAudioController>();
const activeControllers = new Set<AdAudioController>();
const decodedBufferCache = new Map<string, Promise<AudioBuffer | null>>();

let sharedAudioCtx: AudioContext | null = null;
let activeAudioOwner: AdAudioController | null = null;
let globalListenersInstalled = false;
let mainPlayerAudioFocus = false;
let userOutsideSilenced = false;

function isOnMediaDetailRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = (window.location.hash || '').toLowerCase();
  return (
    hash.startsWith('#/filme/') ||
    hash.startsWith('#/serie/') ||
    hash.startsWith('#/player/')
  );
}

function getAudioContextCtor(): (typeof AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext || w.webkitAudioContext || null;
}

function getSharedAudioContext(): AudioContext | null {
  if (sharedAudioCtx) return sharedAudioCtx;
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  try {
    sharedAudioCtx = new Ctor();
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * Silences all page/background ad videos (keeping optional player overlays intact unless `includeOverlays` is true).
 * Called whenever the user clicks a movie, clicks anywhere outside an ad, or opens a movie/player.
 */
export function silenceAllPageAds(includeOverlays = false): void {
  activeControllers.forEach((ctrl) => {
    if (!includeOverlays && ctrl.isPlayerOverlay) return;
    try {
      ctrl.silenceForUserAction();
    } catch {
      // Ignore silence errors
    }
  });
}

/**
 * Called by MovixPlayer while a movie/series player is open so background/page ads ALWAYS stay silent.
 */
export function setMainPlayerAudioFocus(active: boolean): void {
  mainPlayerAudioFocus = active;
  if (active) {
    userOutsideSilenced = true;
    silenceAllPageAds(false);
  }
}

function installUserRespectAudioListeners(): void {
  if (globalListenersInstalled || typeof window === 'undefined') return;
  globalListenersInstalled = true;

  const handlePointerOrClick = (ev: Event) => {
    if (typeof document !== 'undefined' && document.hidden) return;
    const target = ev.target instanceof Element ? ev.target : null;
    const adContainer = target?.closest('[data-movix-ad-container="true"]') ?? null;

    if (!adContainer) {
      // User clicked a movie, card, menu, or anywhere OUTSIDE an ad:
      // Respect the user immediately by muting all page ads and NEVER unmuting them.
      userOutsideSilenced = true;
      silenceAllPageAds(false);
      return;
    }

    // User intentionally interacted INSIDE an ad container:
    // Unlock AudioContext ONLY for the specific ad inside this container (if eligible & unmuted).
    const ctx = getSharedAudioContext();
    if (!ctx) return;

    const resumeTargetAd = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        void ctx.suspend().catch(() => {});
        return;
      }
      activeControllers.forEach((ctrl) => {
        if (adContainer.contains(ctrl.video)) {
          ctrl.resumeIfEligible();
        }
      });
    };

    if (ctx.state === 'suspended') {
      void ctx
        .resume()
        .then(resumeTargetAd)
        .catch(() => {});
    } else if (ctx.state === 'running') {
      resumeTargetAd();
    }
  };

  const handleRouteChange = () => {
    if (isOnMediaDetailRoute()) {
      userOutsideSilenced = true;
      silenceAllPageAds(false);
    } else if (!mainPlayerAudioFocus) {
      userOutsideSilenced = false;
    }
  };

  window.addEventListener('pointerdown', handlePointerOrClick, { capture: true, passive: true });
  window.addEventListener('click', handlePointerOrClick, { capture: true, passive: true });
  window.addEventListener('hashchange', handleRouteChange);
  window.addEventListener('popstate', handleRouteChange);
}

installUserRespectAudioListeners();

/**
 * Immediately stops all active ad Web Audio nodes and suspends the shared AudioContext.
 * Called automatically when the user leaves MOVIX so sound NEVER plays outside the app.
 */
export function suspendAllAdWebAudio(): void {
  activeAudioOwner = null;
  activeControllers.forEach((ctrl) => {
    try {
      ctrl.stopSound();
    } catch {
      // Ignore stop errors
    }
  });
  if (sharedAudioCtx && sharedAudioCtx.state === 'running') {
    void sharedAudioCtx.suspend().catch(() => {});
  }
  clearOsMediaSession();
}

function resolveFetchUrl(rawSrc: string, adId?: string): string {
  if (!rawSrc) return '';
  if (typeof window === 'undefined') return rawSrc;
  try {
    const parsed = new URL(rawSrc, window.location.origin);
    if (parsed.origin === window.location.origin) {
      return parsed.toString();
    }
    if (adId) {
      return `${window.location.origin}/api/ads/${encodeURIComponent(adId)}/audio-source`;
    }
    return parsed.toString();
  } catch {
    return rawSrc;
  }
}

function loadDecodedAudioBuffer(rawSrc: string, adId?: string): Promise<AudioBuffer | null> {
  const fetchUrl = resolveFetchUrl(rawSrc, adId);
  if (!fetchUrl) return Promise.resolve(null);

  const cached = decodedBufferCache.get(fetchUrl);
  if (cached) {
    // Refresh LRU order
    decodedBufferCache.delete(fetchUrl);
    decodedBufferCache.set(fetchUrl, cached);
    return cached;
  }

  const promise = (async (): Promise<AudioBuffer | null> => {
    try {
      const ctx = getSharedAudioContext();
      if (!ctx) return null;

      const res = await fetch(fetchUrl, { credentials: 'same-origin' });
      if (!res.ok) return null;

      const contentLength = Number(res.headers.get('content-length') || 0);
      if (contentLength > MAX_DECODE_BYTES) return null;

      const arrayBuffer = await res.arrayBuffer();
      if (!arrayBuffer || arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > MAX_DECODE_BYTES) {
        return null;
      }

      // decodeAudioData detaches the buffer; slice ensures safety
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      return decoded;
    } catch {
      return null;
    }
  })();

  if (decodedBufferCache.size >= MAX_CACHED_BUFFERS) {
    const oldestKey = decodedBufferCache.keys().next().value;
    if (oldestKey) decodedBufferCache.delete(oldestKey);
  }
  decodedBufferCache.set(fetchUrl, promise);
  return promise;
}

function keepVideoStrictlyMuted(video: HTMLVideoElement): void {
  try {
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.setAttribute('muted', '');
    video.disablePictureInPicture = true;
    video.setAttribute('disableRemotePlayback', 'true');
  } catch {
    // Ignore browser restrictions
  }
}

/**
 * Updates the Web Audio mute state for an ad video WITHOUT ever unmuting the native `<video>` element.
 */
export function setAdVideoMuted(video: HTMLVideoElement | null, muted: boolean): void {
  if (!video) return;
  keepVideoStrictlyMuted(video);
  const ctrl = controllerByVideo.get(video);
  if (ctrl) {
    ctrl.setMuted(muted);
  }
}

export function startAdVideoWithSound(
  video: HTMLVideoElement,
  options: {
    adId?: string;
    autoplay?: boolean;
    forceSilent?: boolean;
    isPlayerOverlay?: boolean;
    onMutedStateChange: (muted: boolean) => void;
    isManuallyMuted: () => boolean;
  }
): () => void {
  let cancelled = false;
  let observer: IntersectionObserver | null = null;
  let isVisible = true;
  let appVisible = typeof document !== 'undefined' ? !document.hidden : true;
  let audioBuffer: AudioBuffer | null = null;
  let sourceNode: AudioBufferSourceNode | null = null;
  let gainNode: GainNode | null = null;
  let audioStartCtxTime = 0;
  let audioStartOffset = 0;
  const forceSilent = Boolean(options.forceSilent);
  const isPlayerOverlay = Boolean(options.isPlayerOverlay);
  let silencedByOutsideAction =
    !isPlayerOverlay && (userOutsideSilenced || mainPlayerAudioFocus || isOnMediaDetailRoute());
  let manualMuted = forceSilent || options.isManuallyMuted() || silencedByOutsideAction;

  // GOLDEN RULE: Ad <video> stays permanently muted so Chrome Android NEVER creates a notification media card
  keepVideoStrictlyMuted(video);
  if (forceSilent || manualMuted) {
    options.onMutedStateChange(true);
  }

  const stopAudioNode = () => {
    if (sourceNode) {
      try {
        sourceNode.onended = null;
        sourceNode.stop();
      } catch {
        // Ignore already-stopped source errors
      }
      try {
        sourceNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      sourceNode = null;
    }
    if (gainNode) {
      try {
        gainNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      gainNode = null;
    }
  };

  const syncWebAudio = (forceRestart = false) => {
    if (cancelled) return;
    keepVideoStrictlyMuted(video);

    const hidden = typeof document !== 'undefined' && document.hidden;
    const blockedByMainPlayer = !isPlayerOverlay && mainPlayerAudioFocus;
    if (
      forceSilent ||
      blockedByMainPlayer ||
      silencedByOutsideAction ||
      !appVisible ||
      hidden ||
      !isVisible ||
      manualMuted ||
      options.isManuallyMuted()
    ) {
      stopAudioNode();
      if (activeAudioOwner === controller) {
        activeAudioOwner = null;
      }
      options.onMutedStateChange(true);
      return;
    }

    if (video.paused || video.ended || !audioBuffer || audioBuffer.duration <= 0.05) {
      stopAudioNode();
      return;
    }

    const ctx = getSharedAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      options.onMutedStateChange(true);
      void ctx
        .resume()
        .then(() => {
          if (!cancelled && appVisible && !document.hidden) {
            syncWebAudio(true);
          }
        })
        .catch(() => {});
      return;
    }

    if (ctx.state !== 'running') {
      options.onMutedStateChange(true);
      return;
    }

    // Claim single ad audio focus so multiple slots never echo
    if (activeAudioOwner && activeAudioOwner !== controller) {
      activeAudioOwner.stopSound();
    }
    activeAudioOwner = controller;

    const rate = video.playbackRate > 0 ? video.playbackRate : 1;
    const rawTime = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;
    const targetOffset =
      audioBuffer.duration > 0 ? rawTime % audioBuffer.duration : 0;

    // If already playing and closely synchronized, keep going without audio glitch
    if (!forceRestart && sourceNode) {
      const elapsedAudio = (ctx.currentTime - audioStartCtxTime) * rate;
      const expectedPos = (audioStartOffset + elapsedAudio) % audioBuffer.duration;
      const drift = Math.abs(expectedPos - targetOffset);
      if (drift < 0.32 || Math.abs(drift - audioBuffer.duration) < 0.32) {
        sourceNode.playbackRate.value = rate;
        options.onMutedStateChange(false);
        return;
      }
    }

    stopAudioNode();

    try {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = audioBuffer;
      src.playbackRate.value = rate;
      src.loop = Boolean(video.loop);
      gain.gain.value = 1;

      src.connect(gain);
      gain.connect(ctx.destination);

      const safeOffset = Math.max(0, Math.min(audioBuffer.duration - 0.02, targetOffset));
      src.start(0, safeOffset);

      sourceNode = src;
      gainNode = gain;
      audioStartCtxTime = ctx.currentTime;
      audioStartOffset = safeOffset;
      options.onMutedStateChange(false);

      src.onended = () => {
        if (sourceNode === src) {
          sourceNode = null;
        }
      };
    } catch {
      stopAudioNode();
    }
  };

  const pauseForBackground = () => {
    appVisible = false;
    stopAudioNode();
    if (activeAudioOwner === controller) {
      activeAudioOwner = null;
    }
    try {
      video.pause();
    } catch {
      // Ignore pause errors
    }
    keepVideoStrictlyMuted(video);
    options.onMutedStateChange(true);
    if (sharedAudioCtx && sharedAudioCtx.state === 'running') {
      void sharedAudioCtx.suspend().catch(() => {});
    }
    clearOsMediaSession();
  };

  const startMutedVisualPlayback = () => {
    if (cancelled || !appVisible || (typeof document !== 'undefined' && document.hidden)) return;
    keepVideoStrictlyMuted(video);
    if (options.autoplay === false) return;
    void video
      .play()
      .then(() => {
        if (cancelled || !appVisible || document.hidden) {
          pauseForBackground();
          return;
        }
        syncWebAudio(false);
        clearOsMediaSession();
      })
      .catch(() => {});
  };

  const controller: AdAudioController = {
    video,
    isPlayerOverlay,
    stopSound: () => {
      stopAudioNode();
      options.onMutedStateChange(true);
    },
    silenceForUserAction: () => {
      silencedByOutsideAction = true;
      manualMuted = true;
      stopAudioNode();
      if (activeAudioOwner === controller) {
        activeAudioOwner = null;
      }
      options.onMutedStateChange(true);
    },
    setMuted: (nextMuted: boolean) => {
      if (!nextMuted && !forceSilent) {
        // User explicitly tapped the ad's own unmute button
        silencedByOutsideAction = false;
        userOutsideSilenced = false;
      }
      manualMuted = forceSilent ? true : nextMuted;
      keepVideoStrictlyMuted(video);
      if (manualMuted) {
        stopAudioNode();
        if (activeAudioOwner === controller) {
          activeAudioOwner = null;
        }
        options.onMutedStateChange(true);
      } else {
        const ctx = getSharedAudioContext();
        if (ctx && ctx.state === 'suspended') {
          void ctx
            .resume()
            .then(() => {
              if (!cancelled && appVisible && !document.hidden) {
                if (video.paused) {
                  void video.play().catch(() => {});
                }
                syncWebAudio(true);
              }
            })
            .catch(() => {});
        } else {
          if (video.paused) {
            void video.play().catch(() => {});
          }
          syncWebAudio(true);
        }
      }
    },
    resumeIfEligible: () => {
      if (cancelled || !appVisible || document.hidden || !isVisible) {
        return;
      }
      const blockedByMainPlayer = !isPlayerOverlay && mainPlayerAudioFocus;
      if (
        forceSilent ||
        blockedByMainPlayer ||
        silencedByOutsideAction ||
        manualMuted ||
        options.isManuallyMuted()
      ) {
        if (video.paused && options.autoplay !== false) {
          startMutedVisualPlayback();
        }
        return;
      }
      if (video.paused && options.autoplay !== false) {
        startMutedVisualPlayback();
      } else {
        syncWebAudio(false);
      }
    },
  };

  controllerByVideo.set(video, controller);
  activeControllers.add(controller);

  // Decode the audio track in the background (skipped completely for forceSilent top header ads)
  const mediaSrc = video.currentSrc || video.getAttribute('src') || video.src;
  if (mediaSrc && !forceSilent) {
    void loadDecodedAudioBuffer(mediaSrc, options.adId).then((buf) => {
      if (cancelled || !buf) return;
      audioBuffer = buf;
      syncWebAudio(true);
    });
  }

  const handlePlayOrPlaying = () => {
    keepVideoStrictlyMuted(video);
    if (!appVisible || (typeof document !== 'undefined' && document.hidden)) {
      pauseForBackground();
      return;
    }
    syncWebAudio(false);
  };

  const handlePauseOrStop = () => {
    stopAudioNode();
    if (activeAudioOwner === controller) {
      activeAudioOwner = null;
    }
    clearOsMediaSession();
  };

  const handleSeeked = () => {
    if (!video.paused) {
      syncWebAudio(true);
    }
  };

  const handleRateChange = () => {
    if (sourceNode && video.playbackRate > 0) {
      sourceNode.playbackRate.value = video.playbackRate;
    }
  };

  const handleTimeUpdate = () => {
    if (!video.paused && !manualMuted && isVisible && appVisible && !document.hidden) {
      syncWebAudio(false);
    }
  };

  const handleVolumeEnforce = () => {
    if (!video.muted || video.volume !== 0) {
      keepVideoStrictlyMuted(video);
    }
  };

  const handleVisibilityChange = () => {
    if (cancelled) return;
    if (document.hidden) {
      pauseForBackground();
    } else {
      appVisible = true;
      if (isVisible) {
        startMutedVisualPlayback();
      }
    }
  };

  const handlePageHide = () => {
    if (!cancelled) {
      pauseForBackground();
    }
  };

  video.addEventListener('play', handlePlayOrPlaying);
  video.addEventListener('playing', handlePlayOrPlaying);
  video.addEventListener('pause', handlePauseOrStop);
  video.addEventListener('waiting', handlePauseOrStop);
  video.addEventListener('stalled', handlePauseOrStop);
  video.addEventListener('ended', handlePauseOrStop);
  video.addEventListener('seeked', handleSeeked);
  video.addEventListener('ratechange', handleRateChange);
  video.addEventListener('timeupdate', handleTimeUpdate);
  video.addEventListener('volumechange', handleVolumeEnforce);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('freeze', handlePageHide);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', handlePageHide);
  }

  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry || cancelled) return;
        isVisible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
        if (isVisible && appVisible && !document.hidden) {
          startMutedVisualPlayback();
          syncWebAudio(false);
        } else {
          stopAudioNode();
          if (activeAudioOwner === controller) {
            activeAudioOwner = null;
          }
          options.onMutedStateChange(true);
        }
      },
      { threshold: [0, 0.25, 0.5] }
    );
    observer.observe(video);
  }

  if (appVisible) {
    startMutedVisualPlayback();
  } else {
    pauseForBackground();
  }

  return () => {
    cancelled = true;
    stopAudioNode();
    controllerByVideo.delete(video);
    activeControllers.delete(controller);
    if (activeAudioOwner === controller) {
      activeAudioOwner = null;
    }

    video.removeEventListener('play', handlePlayOrPlaying);
    video.removeEventListener('playing', handlePlayOrPlaying);
    video.removeEventListener('pause', handlePauseOrStop);
    video.removeEventListener('waiting', handlePauseOrStop);
    video.removeEventListener('stalled', handlePauseOrStop);
    video.removeEventListener('ended', handlePauseOrStop);
    video.removeEventListener('seeked', handleSeeked);
    video.removeEventListener('ratechange', handleRateChange);
    video.removeEventListener('timeupdate', handleTimeUpdate);
    video.removeEventListener('volumechange', handleVolumeEnforce);

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('freeze', handlePageHide);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', handlePageHide);
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    try {
      video.pause();
    } catch {
      // Ignore pause errors
    }
    keepVideoStrictlyMuted(video);
    clearOsMediaSession();
  };
}
