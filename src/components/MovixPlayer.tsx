import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  AlertCircle,
  BookmarkCheck,
  BookmarkPlus,
  Cast,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  FlipHorizontal2,
  Gauge,
  HelpCircle,
  Layers,
  Loader2,
  Lock,
  Maximize,
  MessageSquareText,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Send,
  Server,
  Share2,
  SkipForward,
  Subtitles,
  Sun,
  SunDim,
  Tv,
  Unlock,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { setMainPlayerAudioFocus } from '../lib/adVideoAudio';
import { movixApi } from '../lib/api';
import {
  clearOsMediaSession,
  getDocumentPictureInPicture,
  isElementInNativePip,
  sendYouTubeCommand,
  type WebKitVideoElement,
} from '../lib/mediaLifecycle';
import { isSavedOffline, removeOfflineItem, saveItemForOffline } from '../lib/offlineCache';
import { getWatchProgress, recordWatchHistory, saveWatchProgress } from '../lib/storage';
import {
  getPlayerTourSteps,
  getTourUiLabels,
  isPlayerTourDone,
  markPlayerTourDone,
} from '../lib/tour';
import { GuidedSpotlightTour } from './GuidedSpotlightTour';
import { MovixPlayerAdOverlay } from './MovixAdSlot';
import type {
  MediaSummary,
  MovieDetails,
  PlaybackRequest,
  SeasonDetails,
  SeriesDetails,
} from '../types/movix';

interface MovixPlayerProps {
  request: PlaybackRequest;
  onClose: () => void;
  onPlayNextEpisode?: () => void;
  favoriteKeys?: Set<string>;
  onToggleFavorite?: (item: MediaSummary) => void;
  onSelectMedia?: (item: MediaSummary) => void;
  onSelectEpisode?: (seasonNumber: number, episodeNumber: number, episodeTitle: string) => void;
}

type AspectMode = 'default' | 'full' | '16:9' | '4:3';
type RightDrawerTab = 'display' | 'playlist' | 'speed' | null;

interface LiveCommentItem {
  id: string;
  text: string;
  author: string;
  lane: number;
}

const ALLOWED_EMBED_HOSTS = new Set([
  'megaembed.com',
  'www.megaembed.com',
  'mgeb.space',
  'api.mgeb.space',
]);

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const ROTATION_PRESETS = [0, 90, 180, 270] as const;

function getSafeEmbedUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return null;
    if (ALLOWED_EMBED_HOSTS.has(parsed.hostname.toLowerCase())) {
      return parsed.toString();
    }
    // Also permit public HTTPS embed servers configured explicitly in MOVIX ADM
    const host = parsed.hostname.toLowerCase();
    if (host && host !== 'localhost' && !host.startsWith('127.') && !host.startsWith('192.168.') && !host.startsWith('10.')) {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatClockNow(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function ScreenDisplayIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M9.5 9.5L7 12l2.5 2.5" />
      <path d="M14.5 9.5L17 12l-2.5 2.5" />
    </svg>
  );
}

function BatteryIndicator({ level, charging }: { level: number | null; charging: boolean }) {
  const pct = level !== null ? Math.max(8, Math.min(100, Math.round(level * 100))) : 88;
  return (
    <span className="relative inline-flex items-center" aria-hidden="true">
      <span className="w-[22px] h-[11px] rounded-[2.5px] border border-white/85 p-[1.5px] flex items-center">
        <span
          className={`h-full rounded-[1px] transition-all ${
            charging ? 'bg-emerald-400' : pct <= 20 ? 'bg-rose-400' : 'bg-white'
          }`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-[2px] h-[5px] bg-white/80 rounded-r-[1px] ml-[1px]" />
    </span>
  );
}

export function MovixPlayer({
  request,
  onClose,
  onPlayNextEpisode,
  favoriteKeys,
  onToggleFavorite,
  onSelectMedia,
  onSelectEpisode,
}: MovixPlayerProps) {
  const { t, language: appLanguage, user } = useAuth();
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trailerIframeRef = useRef<HTMLIFrameElement>(null);
  const mediaSlotRef = useRef<HTMLDivElement>(null);
  const mediaHostRef = useRef<HTMLDivElement>(null);
  const docPipWindowRef = useRef<Window | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const resumeStreamTimeRef = useRef<number>(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ time: number; side: 'left' | 'right' } | null>(null);
  const seekHudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureRef = useRef<{
    startY: number;
    startVal: number;
    side: 'left' | 'right';
    moved: boolean;
  } | null>(null);

  // Respect user movie/series audio: keep all background/page ads strictly silent while player is open
  useEffect(() => {
    setMainPlayerAudioFocus(true);
    return () => {
      setMainPlayerAudioFocus(false);
    };
  }, []);

  const safeMirrors = useMemo(() => {
    const list = (request.embedMirrors || [])
      .map((m) => ({ label: m.label, url: getSafeEmbedUrl(m.url) }))
      .filter((m): m is { label: string; url: string } => Boolean(m.url));
    const direct = getSafeEmbedUrl(request.embedUrl);
    if (direct && !list.some((m) => m.url === direct)) {
      list.unshift({ label: 'MegaEmbed HD', url: direct });
    }
    return list;
  }, [request.embedUrl, request.embedMirrors]);

  const initialMode = request.megambdStreamUrl
    ? 'stream'
    : safeMirrors.length > 0
      ? 'embed'
      : request.trailerKey
        ? 'trailer'
        : 'stream';

  const [mode, setMode] = useState<'stream' | 'embed' | 'trailer'>(initialMode);
  const [mirrorIdx, setMirrorIdx] = useState(0);
  const [language, setLanguage] = useState<'dublado' | 'legendado'>('dublado');
  const [subtitlesOn, setSubtitlesOn] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [brightness, setBrightness] = useState(1); // 0.35 to 1.4
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [aspectMode, setAspectMode] = useState<AspectMode>('default');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cinemaExpanded, setCinemaExpanded] = useState(false);
  const [isNativePip, setIsNativePip] = useState(false);
  const [isMiniPip, setIsMiniPip] = useState(false);
  const [backgroundSuspended, setBackgroundSuspended] = useState(false);
  const [isMobileLandscape, setIsMobileLandscape] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth > window.innerHeight && window.innerHeight <= 560 : false
  );
  const [controlsVisible, setControlsVisible] = useState(true);
  const [controlsLocked, setControlsLocked] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<RightDrawerTab>(null);
  const [streamError, setStreamError] = useState<string | null>(request.megambdError || null);
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  const [activePlayerAd, setActivePlayerAd] = useState<'before_player' | 'during_playback' | 'after_playback' | null>('before_player');
  const midRollTriggeredRef = useRef(false);

  useEffect(() => {
    midRollTriggeredRef.current = false;
    setActivePlayerAd('before_player');
  }, [request.tmdbId, request.seasonNumber, request.episodeNumber]);

  useEffect(() => {
    if (
      activePlayerAd === null &&
      !midRollTriggeredRef.current &&
      duration > 60 &&
      currentTime / duration >= 0.45 &&
      currentTime / duration < 0.55
    ) {
      midRollTriggeredRef.current = true;
      setActivePlayerAd('during_playback');
      videoRef.current?.pause();
    }
  }, [currentTime, duration, activePlayerAd]);

  // Full 360° Rotation & Mirror State
  const [rotationDeg, setRotationDeg] = useState<number>(0);
  const [mirrored, setMirrored] = useState(false);

  // Live Clock & Battery for Landscape Cinema Top-Right HUD
  const [clockText, setClockText] = useState<string>(() => formatClockNow());
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [batteryCharging, setBatteryCharging] = useState(false);

  // Live On-Screen Comments (Danmaku)
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentFocused, setCommentFocused] = useState(false);
  const [liveComments, setLiveComments] = useState<LiveCommentItem[]>([]);

  // Hover scrub preview, double-tap & vertical swipe HUDs
  const [hoverTime, setHoverTime] = useState<{ pct: number; time: number } | null>(null);
  const [seekHud, setSeekHud] = useState<{ side: 'left' | 'right'; label: string } | null>(null);
  const [gestureHud, setGestureHud] = useState<{ kind: 'brightness' | 'volume'; pct: number } | null>(null);

  // Rich details, intro drawer, episodes, feedback, and offline cache state
  const [details, setDetails] = useState<MovieDetails | SeriesDetails | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(request.seasonNumber || 1);
  const [seasonData, setSeasonData] = useState<SeasonDetails | null>(null);
  const [showIntro, setShowIntro] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [savedOffline, setSavedOffline] = useState(() =>
    isSavedOffline(request.mediaType, request.tmdbId)
  );
  const [savingOffline, setSavingOffline] = useState(false);
  const [playerTourActive, setPlayerTourActive] = useState(false);

  const playerTourSteps = useMemo(() => getPlayerTourSteps(appLanguage), [appLanguage]);
  const tourUi = useMemo(() => getTourUiLabels(appLanguage), [appLanguage]);

  const finishPlayerTour = useCallback(() => {
    markPlayerTourDone();
    setPlayerTourActive(false);
  }, []);

  const openPlayerTour = useCallback(() => {
    setControlsLocked(false);
    setActiveDrawer(null);
    setControlsVisible(true);
    setPlayerTourActive(true);
  }, []);

  const isAnyPipActive = isNativePip || isMiniPip;
  const isCinemaMode = !isMiniPip && (isFullscreen || cinemaExpanded || isMobileLandscape);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2600);
  }, []);

  // Track device physical landscape orientation
  useEffect(() => {
    const updateOrientation = () => {
      const mobileLand = window.innerWidth > window.innerHeight && window.innerHeight <= 560;
      setIsMobileLandscape(mobileLand);
    };
    window.addEventListener('resize', updateOrientation);
    window.addEventListener('orientationchange', updateOrientation);
    return () => {
      window.removeEventListener('resize', updateOrientation);
      window.removeEventListener('orientationchange', updateOrientation);
    };
  }, []);

  // Live clock & optional Battery API
  useEffect(() => {
    const timer = setInterval(() => setClockText(formatClockNow()), 15_000);
    let batteryCleanup: (() => void) | undefined;
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{
        level: number;
        charging: boolean;
        addEventListener: (ev: string, fn: () => void) => void;
        removeEventListener: (ev: string, fn: () => void) => void;
      }>;
    };
    if (typeof nav.getBattery === 'function') {
      void nav
        .getBattery()
        .then((bat) => {
          const sync = () => {
            setBatteryLevel(bat.level);
            setBatteryCharging(bat.charging);
          };
          sync();
          bat.addEventListener('levelchange', sync);
          bat.addEventListener('chargingchange', sync);
          batteryCleanup = () => {
            bat.removeEventListener('levelchange', sync);
            bat.removeEventListener('chargingchange', sync);
          };
        })
        .catch(() => {});
    }
    return () => {
      clearInterval(timer);
      batteryCleanup?.();
    };
  }, []);

  const normalizedAngle = ((rotationDeg % 360) + 360) % 360;

  // Compute clean transform + aspect geometry + live brightness filter
  const mediaVisualStyle = useMemo(() => {
    const rad = (normalizedAngle * Math.PI) / 180;
    const sinA = Math.abs(Math.sin(rad));
    const cosA = Math.abs(Math.cos(rad));
    const ratio = 16 / 9;

    let fitScale = 1;
    if (normalizedAngle !== 0) {
      const boundScale = 1 / (cosA + sinA * ratio);
      fitScale = aspectMode === 'full' ? Math.max(1, ratio * sinA + cosA) : Math.max(0.5625, boundScale);
    } else if (aspectMode === 'full') {
      fitScale = 1.08;
    }

    const flipX = mirrored ? -1 : 1;
    return {
      transform: `rotate(${rotationDeg}deg) scale(${(fitScale * flipX).toFixed(4)}, ${fitScale.toFixed(4)})`,
      filter: `brightness(${brightness.toFixed(2)})`,
    };
  }, [rotationDeg, normalizedAngle, mirrored, aspectMode, brightness]);

  const aspectFrameClass = useMemo(() => {
    switch (aspectMode) {
      case 'full':
        return 'w-full h-full object-cover';
      case '16:9':
        return 'w-full aspect-video max-h-full mx-auto object-fill';
      case '4:3':
        return 'h-full aspect-[4/3] max-w-full mx-auto object-fill';
      default:
        return 'w-full h-full object-contain';
    }
  }, [aspectMode]);

  const progressKey =
    request.mediaType === 'tv' &&
    request.seasonNumber !== undefined &&
    request.episodeNumber !== undefined
      ? `tv:${request.tmdbId}:s${request.seasonNumber}:e${request.episodeNumber}`
      : `movie:${request.tmdbId}`;

  const activeEmbedUrl = useMemo(() => {
    const base = safeMirrors[mirrorIdx]?.url || safeMirrors[0]?.url || null;
    if (!base) return null;
    try {
      const parsed = new URL(base);
      parsed.searchParams.set('lang', language === 'dublado' ? 'pt-BR' : 'orig');
      if (language === 'legendado' || subtitlesOn) {
        parsed.searchParams.set('sub', 'pt');
      }
      return parsed.toString();
    } catch {
      return base;
    }
  }, [safeMirrors, mirrorIdx, language, subtitlesOn]);

  const scheduleHideControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (playing && !activeDrawer && !commentFocused && !playerTourActive) {
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3200);
    }
  }, [playing, activeDrawer, commentFocused, playerTourActive]);

  useEffect(() => {
    scheduleHideControls();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [playing, activeDrawer, commentFocused, playerTourActive, scheduleHideControls]);

  useEffect(() => {
    if (request.loadingSource || isPlayerTourDone()) return;
    const timer = setTimeout(() => {
      if (!isPlayerTourDone()) {
        setControlsLocked(false);
        setActiveDrawer(null);
        setControlsVisible(true);
        setPlayerTourActive(true);
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [request.loadingSource]);

  useEffect(() => {
    setMode(
      request.megambdStreamUrl
        ? 'stream'
        : safeMirrors.length > 0
          ? 'embed'
          : request.trailerKey
            ? 'trailer'
            : 'stream'
    );
    setMirrorIdx(0);
    setStreamError(request.megambdError || null);
    setNextCountdown(null);
    setCurrentTime(0);
    setDuration(0);
    setBufferedEnd(0);
    setBuffering(false);
    setShowIntro(false);
    setShowFeedback(false);
    setFeedbackSent(false);
    setActiveDrawer(null);
    setBackgroundSuspended(false);
    setSavedOffline(isSavedOffline(request.mediaType, request.tmdbId));
    if (request.seasonNumber) {
      setSelectedSeason(request.seasonNumber);
    }
  }, [request, safeMirrors.length]);

  useEffect(() => {
    setIsMiniPip(false);
  }, [request.tmdbId, request.mediaType]);

  // Fetch full TMDB metadata
  useEffect(() => {
    if (!request.tmdbId || request.tmdbId <= 0) {
      setDetails(null);
      return;
    }
    let cancelled = false;
    async function loadMeta() {
      try {
        if (request.mediaType === 'movie') {
          const data = await movixApi.getMovieDetails(request.tmdbId);
          if (!cancelled) setDetails(data);
        } else {
          const data = await movixApi.getSeriesDetails(request.tmdbId);
          if (!cancelled) {
            setDetails(data);
            if (!request.seasonNumber && data.seasons[0]?.seasonNumber) {
              setSelectedSeason(data.seasons[0].seasonNumber);
            }
          }
        }
      } catch {
        if (!cancelled) setDetails(null);
      }
    }
    void loadMeta();
    return () => {
      cancelled = true;
    };
  }, [request.mediaType, request.tmdbId, request.seasonNumber, appLanguage]);

  // Load season episodes for TV series
  useEffect(() => {
    if (request.mediaType !== 'tv' || !request.tmdbId || request.tmdbId <= 0) {
      setSeasonData(null);
      return;
    }
    let cancelled = false;
    async function loadSeason() {
      try {
        const s = await movixApi.getSeriesSeason(request.tmdbId, selectedSeason);
        if (!cancelled) setSeasonData(s);
      } catch {
        if (!cancelled) setSeasonData(null);
      }
    }
    void loadSeason();
    return () => {
      cancelled = true;
    };
  }, [request.mediaType, request.tmdbId, selectedSeason, appLanguage]);

  // Record watch history for embed mode
  useEffect(() => {
    if (mode !== 'embed' || !activeEmbedUrl || request.loadingSource) return;
    const existing = getWatchProgress(
      request.mediaType,
      request.tmdbId,
      request.seasonNumber,
      request.episodeNumber
    );
    recordWatchHistory({
      key: progressKey,
      tmdbId: request.tmdbId,
      mediaType: request.mediaType,
      title: request.title,
      posterUrl: request.posterUrl ?? details?.posterUrl ?? null,
      backdropUrl: request.backdropUrl ?? details?.backdropUrl ?? null,
      seasonNumber: request.seasonNumber,
      episodeNumber: request.episodeNumber,
      episodeTitle: request.episodeTitle,
      currentTime: existing?.currentTime || 0,
      duration: existing?.duration || 0,
      updatedAt: new Date().toISOString(),
    });
  }, [mode, activeEmbedUrl, progressKey, request, details]);

  // Attach direct stream source (MP4 or HLS m3u8)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || mode !== 'stream' || !request.megambdStreamUrl || backgroundSuspended) return;

    const src = request.megambdStreamUrl;
    setStreamError(null);
    setBuffering(true);

    const saved = getWatchProgress(
      request.mediaType,
      request.tmdbId,
      request.seasonNumber,
      request.episodeNumber
    );

    const seekToSaved = () => {
      const resumeAt = resumeStreamTimeRef.current;
      if (resumeAt > 2 && video.duration && resumeAt < video.duration - 5) {
        video.currentTime = resumeAt;
        resumeStreamTimeRef.current = 0;
        return;
      }
      if (saved && saved.currentTime > 10 && video.duration && saved.currentTime < video.duration - 15) {
        video.currentTime = saved.currentTime;
      }
    };

    if (src.includes('.m3u8') && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        seekToSaved();
        video.playbackRate = playbackRate;
        if (!document.hidden) {
          void video.play().catch(() => {});
        }
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          setBuffering(false);
          setStreamError('Não foi possível carregar o fluxo autorizado a partir do servidor MegamBD.');
        }
      });
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }

    video.src = src;
    const onLoaded = () => {
      seekToSaved();
      video.playbackRate = playbackRate;
      if (!document.hidden) {
        void video.play().catch(() => {});
      }
    };
    video.addEventListener('loadedmetadata', onLoaded);
    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
    };
  }, [mode, request, backgroundSuspended]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      v.volume = volume;
      v.muted = muted;
    }
  }, [volume, muted]);

  // Auto-save watch progress & history for native stream
  useEffect(() => {
    if (mode !== 'stream' || !request.megambdStreamUrl) return;
    const interval = setInterval(() => {
      const v = videoRef.current;
      if (!v || !v.duration || v.currentTime < 3) return;
      const entry = {
        key: progressKey,
        tmdbId: request.tmdbId,
        mediaType: request.mediaType,
        title: request.title,
        posterUrl: request.posterUrl ?? null,
        backdropUrl: request.backdropUrl ?? null,
        seasonNumber: request.seasonNumber,
        episodeNumber: request.episodeNumber,
        episodeTitle: request.episodeTitle,
        currentTime: v.currentTime,
        duration: v.duration,
        updatedAt: new Date().toISOString(),
      };
      saveWatchProgress(entry);
      recordWatchHistory(entry);
    }, 4000);
    return () => clearInterval(interval);
  }, [mode, progressKey, request]);

  // Next episode countdown timer
  useEffect(() => {
    if (nextCountdown === null) return;
    if (nextCountdown <= 0) {
      setNextCountdown(null);
      onPlayNextEpisode?.();
      return;
    }
    const timer = setTimeout(() => setNextCountdown((c) => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(timer);
  }, [nextCountdown, onPlayNextEpisode]);

  const handleQuickRotate90 = useCallback(() => {
    setRotationDeg((prev) => {
      const next = (prev + 90) % 360;
      showToast(`${t.rotate360}: ${next}°`);
      return next;
    });
    scheduleHideControls();
  }, [showToast, t.rotate360, scheduleHideControls]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v || controlsLocked) return;
    if (v.paused) void v.play();
    else v.pause();
    scheduleHideControls();
  };

  const skip = (delta: number) => {
    const v = videoRef.current;
    if (!v || controlsLocked) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
    setSeekHud({ side: delta < 0 ? 'left' : 'right', label: delta < 0 ? `${delta}s` : `+${delta}s` });
    if (seekHudTimerRef.current) clearTimeout(seekHudTimerRef.current);
    seekHudTimerRef.current = setTimeout(() => setSeekHud(null), 650);
    scheduleHideControls();
  };

  const toggleCinemaFullscreen = async () => {
    if (document.fullscreenElement || cinemaExpanded) {
      setCinemaExpanded(false);
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }
      try {
        (screen.orientation as { unlock?: () => void })?.unlock?.();
      } catch {
        // Ignore unlock errors
      }
      return;
    }

    setCinemaExpanded(true);
    if (videoContainerRef.current) {
      await videoContainerRef.current.requestFullscreen().catch(() => {});
    }
    try {
      await (screen.orientation as { lock?: (o: string) => Promise<void> })?.lock?.('landscape');
    } catch {
      // Fallback full-viewport cinema mode stays active even when orientation lock is unsupported
    }
  };

  const handleBackAction = () => {
    if (activeDrawer) {
      setActiveDrawer(null);
      return;
    }
    if (document.fullscreenElement || cinemaExpanded) {
      void toggleCinemaFullscreen();
      return;
    }
    onClose();
  };

  const closeDocumentPip = useCallback(() => {
    const pipWin = docPipWindowRef.current;
    const host = mediaHostRef.current;
    const slot = mediaSlotRef.current;
    if (host && slot && host.parentElement !== slot) {
      host.style.width = '';
      host.style.height = '';
      slot.appendChild(host);
    }
    docPipWindowRef.current = null;
    setIsNativePip(false);
    if (pipWin && !pipWin.closed) {
      try {
        pipWin.close();
      } catch {
        // Ignore close errors
      }
    }
  }, []);

  // Track native HTML5 / WebKit Picture-in-Picture lifecycle & stop orphan audio if PiP closes in background
  useEffect(() => {
    const v = videoRef.current as WebKitVideoElement | null;
    if (!v) return;
    try {
      v.disablePictureInPicture = false;
      v.autoPictureInPicture = false;
    } catch {
      // Ignore browser restrictions
    }

    const onEnterPip = () => {
      setIsNativePip(true);
      setIsMiniPip(false);
    };
    const onLeavePip = () => {
      setIsNativePip(false);
      if (document.hidden) {
        try {
          v.pause();
        } catch {
          // Ignore pause errors
        }
        clearOsMediaSession();
      }
    };
    const onWebkitModeChange = () => {
      const pip = v.webkitPresentationMode === 'picture-in-picture';
      setIsNativePip(pip);
      if (pip) {
        setIsMiniPip(false);
      } else if (document.hidden) {
        try {
          v.pause();
        } catch {
          // Ignore pause errors
        }
        clearOsMediaSession();
      }
    };

    v.addEventListener('enterpictureinpicture', onEnterPip);
    v.addEventListener('leavepictureinpicture', onLeavePip);
    v.addEventListener('webkitpresentationmodechanged', onWebkitModeChange);
    return () => {
      v.removeEventListener('enterpictureinpicture', onEnterPip);
      v.removeEventListener('leavepictureinpicture', onLeavePip);
      v.removeEventListener('webkitpresentationmodechanged', onWebkitModeChange);
    };
  }, [mode, request.megambdStreamUrl, streamError]);

  // Strict in-app audio isolation:
  // When leaving MOVIX (app minimized / switched / screen locked), immediately pause, mute,
  // unmount media, and tear down OS notification media controls UNLESS native OS Picture-in-Picture is active.
  useEffect(() => {
    const suspendForBackground = () => {
      const v = videoRef.current;
      if (isElementInNativePip(v, docPipWindowRef.current)) {
        return;
      }

      if (v) {
        if (Number.isFinite(v.currentTime) && v.currentTime > 1) {
          resumeStreamTimeRef.current = v.currentTime;
        }
        try {
          v.pause();
          v.muted = true;
        } catch {
          // Ignore pause/mute errors
        }
      }

      if (trailerIframeRef.current) {
        sendYouTubeCommand(trailerIframeRef.current, 'pauseVideo');
        sendYouTubeCommand(trailerIframeRef.current, 'mute');
      }

      // Unmount stream/trailer/embed while hidden so Android Chrome immediately silences playback
      // AND destroys any OS notification-shade media player card.
      setBackgroundSuspended(true);
      clearOsMediaSession();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        suspendForBackground();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('freeze', suspendForBackground);
    window.addEventListener('pagehide', suspendForBackground);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('freeze', suspendForBackground);
      window.removeEventListener('pagehide', suspendForBackground);
    };
  }, [mode]);

  // Ensure Document PiP, native PiP, and OS media session are cleanly released on unmount
  useEffect(() => {
    return () => {
      closeDocumentPip();
      if (document.pictureInPictureElement && document.pictureInPictureElement === videoRef.current) {
        void document.exitPictureInPicture().catch(() => {});
      }
      clearOsMediaSession();
    };
  }, [closeDocumentPip]);

  // Reset suspended overlay when user switches mode or mirror
  useEffect(() => {
    setBackgroundSuspended(false);
  }, [mode, mirrorIdx]);

  const togglePictureInPicture = async () => {
    // 1. If in-app floating mini-PiP is active, restore full player
    if (isMiniPip) {
      setIsMiniPip(false);
      showToast(t.pipRestored);
      return;
    }

    // 2. If Document PiP window is open, bring media back
    if (docPipWindowRef.current && !docPipWindowRef.current.closed) {
      closeDocumentPip();
      showToast(t.pipClosed);
      return;
    }

    // 3. Direct HTML5 / HLS Video stream PiP (Standard -> WebKit Safari -> Floating Mini-PiP fallback)
    if (mode === 'stream' && videoRef.current) {
      const v = videoRef.current as WebKitVideoElement;
      try {
        if (document.pictureInPictureElement === v) {
          await document.exitPictureInPicture();
          return;
        }
        if (v.webkitPresentationMode === 'picture-in-picture') {
          v.webkitSetPresentationMode?.('inline');
          return;
        }
        if (document.fullscreenElement) {
          await document.exitFullscreen().catch(() => {});
        }
        if (document.pictureInPictureEnabled && typeof v.requestPictureInPicture === 'function') {
          await v.requestPictureInPicture();
          setIsNativePip(true);
          showToast(t.pipActive);
          return;
        }
        if (
          typeof v.webkitSupportsPresentationMode === 'function' &&
          v.webkitSupportsPresentationMode('picture-in-picture')
        ) {
          v.webkitSetPresentationMode?.('picture-in-picture');
          setIsNativePip(true);
          showToast(t.pipActive);
          return;
        }
      } catch {
        // Fall through to floating in-app mini-player PiP
      }
    }

    // 4. Embed / Trailer Document Picture-in-Picture (OS floating window where supported)
    if ((mode === 'embed' || mode === 'trailer') && !backgroundSuspended) {
      const dpip = getDocumentPictureInPicture();
      const host = mediaHostRef.current;
      const slot = mediaSlotRef.current;
      if (dpip && host && slot) {
        try {
          if (document.fullscreenElement) {
            await document.exitFullscreen().catch(() => {});
          }
          setCinemaExpanded(false);
          setActiveDrawer(null);
          const pipWin = await dpip.requestWindow({ width: 480, height: 270 });
          pipWin.document.title = `${details?.title || request.title} · MOVIX`;
          pipWin.document.documentElement.style.cssText =
            'margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden;';
          pipWin.document.body.style.cssText =
            'margin:0;padding:0;width:100vw;height:100vh;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;';
          host.style.width = '100%';
          host.style.height = '100%';
          pipWin.document.body.appendChild(host);
          docPipWindowRef.current = pipWin;
          setIsNativePip(true);
          showToast(t.pipActive);

          pipWin.addEventListener('pagehide', () => {
            if (host && slot && host.parentElement !== slot) {
              host.style.width = '';
              host.style.height = '';
              slot.appendChild(host);
            }
            docPipWindowRef.current = null;
            setIsNativePip(false);
            if (document.hidden) {
              if (trailerIframeRef.current) {
                sendYouTubeCommand(trailerIframeRef.current, 'pauseVideo');
                sendYouTubeCommand(trailerIframeRef.current, 'mute');
              }
              setBackgroundSuspended(true);
              clearOsMediaSession();
            }
          });
          return;
        } catch {
          // Fall through to in-app floating mini-player PiP
        }
      }
    }

    // 5. Universal Floating Mini-Player PiP fallback (works on all mobile & desktop browsers)
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }
    setCinemaExpanded(false);
    setActiveDrawer(null);
    setIsMiniPip(true);
    showToast(t.pipActive);
  };

  useEffect(() => {
    const onFsChange = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
      if (!fs) setCinemaExpanded(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (commentFocused) return;
      if (e.key === 'Escape') {
        if (activeDrawer) {
          setActiveDrawer(null);
        } else if (cinemaExpanded && !document.fullscreenElement) {
          setCinemaExpanded(false);
        } else if (!document.fullscreenElement) {
          onClose();
        }
        return;
      }
      if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) {
        handleQuickRotate90();
        return;
      }
      if (mode !== 'stream' || !request.megambdStreamUrl || controlsLocked) return;
      if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        skip(-10);
      } else if (e.key === 'ArrowRight') {
        skip(10);
      } else if (e.key.toLowerCase() === 'm') {
        setMuted((prev) => !prev);
      } else if (e.key.toLowerCase() === 'f') {
        void toggleCinemaFullscreen();
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      window.removeEventListener('keydown', onKey);
    };
  });

  // Vertical swipe gestures: Left = Brightness, Right = Volume
  const handleTouchStartStage = (e: React.TouchEvent<HTMLDivElement>) => {
    scheduleHideControls();
    if (controlsLocked || activeDrawer || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const side: 'left' | 'right' = touch.clientX - rect.left < rect.width * 0.5 ? 'left' : 'right';
    gestureRef.current = {
      startY: touch.clientY,
      startVal: side === 'left' ? brightness : muted ? 0 : volume,
      side,
      moved: false,
    };
  };

  const handleTouchMoveStage = (e: React.TouchEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g || e.touches.length !== 1 || controlsLocked) return;
    const deltaY = g.startY - e.touches[0].clientY;
    if (!g.moved && Math.abs(deltaY) < 16) return;
    g.moved = true;
    const sensitivity = 220;
    if (g.side === 'left') {
      const nextB = Math.max(0.35, Math.min(1.4, g.startVal + deltaY / sensitivity));
      setBrightness(nextB);
      setGestureHud({ kind: 'brightness', pct: Math.round(((nextB - 0.35) / 1.05) * 100) });
    } else {
      const nextV = Math.max(0, Math.min(1, g.startVal + deltaY / sensitivity));
      setVolume(nextV);
      if (nextV > 0 && muted) setMuted(false);
      setGestureHud({ kind: 'volume', pct: Math.round(nextV * 100) });
    }
  };

  const handleTouchEndStage = () => {
    gestureRef.current = null;
    if (gestureHud) {
      setTimeout(() => setGestureHud(null), 550);
    }
  };

  const handleStageTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeDrawer) {
      setActiveDrawer(null);
      return;
    }
    if (controlsLocked) {
      setControlsVisible((v) => !v);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const now = Date.now();
    const side: 'left' | 'right' = relX < 0.5 ? 'left' : 'right';

    if (lastTapRef.current && lastTapRef.current.side === side && now - lastTapRef.current.time < 280) {
      lastTapRef.current = null;
      skip(side === 'left' ? -10 : 10);
      return;
    }
    lastTapRef.current = { time: now, side };
    setControlsVisible((prev) => {
      const next = !prev;
      if (next) scheduleHideControls();
      return next;
    });
  };

  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration || !videoRef.current || controlsLocked) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = pct * duration;
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    scheduleHideControls();
  };

  const handleScrubHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverTime({ pct: pct * 100, time: pct * duration });
  };

  const handleSendLiveComment = (e: React.FormEvent) => {
    e.preventDefault();
    const text = commentDraft.trim().slice(0, 90);
    if (!text) return;
    const id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const lane = Math.floor(Math.random() * 4);
    const author = user?.displayName || 'MOVIX';
    setCommentsEnabled(true);
    setLiveComments((prev) => [...prev.slice(-12), { id, text, author, lane }]);
    setCommentDraft('');
    setTimeout(() => {
      setLiveComments((prev) => prev.filter((item) => item.id !== id));
    }, 9200);
  };

  const mediaKey = `${request.mediaType}:${request.tmdbId}`;
  const isFav = favoriteKeys ? favoriteKeys.has(mediaKey) : false;

  const summaryPayload: MediaSummary = {
    id: request.tmdbId,
    mediaType: request.mediaType,
    title: details?.title || request.title,
    originalTitle: details?.originalTitle || request.title,
    overview: details?.overview || '',
    posterUrl: details?.posterUrl || request.posterUrl || null,
    backdropUrl: details?.backdropUrl || request.backdropUrl || null,
    year: details?.year || '',
    releaseDate: details?.releaseDate || '',
    rating: details?.rating || 0,
    voteCount: details?.voteCount || 0,
    genreIds: details?.genres?.map((g) => g.id) || [],
    popularity: 0,
  };

  const handleToggleFav = () => {
    if (!onToggleFavorite) return;
    onToggleFavorite(summaryPayload);
    showToast(isFav ? 'Removido dos favoritos' : 'Adicionado aos favoritos');
  };

  const handleToggleOfflineDownload = async () => {
    setSavingOffline(true);
    try {
      if (savedOffline) {
        await removeOfflineItem(mediaKey);
        setSavedOffline(false);
        showToast('Removido do armazenamento offline');
      } else {
        if (!isFav && onToggleFavorite) {
          onToggleFavorite(summaryPayload);
        }
        await saveItemForOffline({
          mediaType: request.mediaType,
          tmdbId: request.tmdbId,
          title: summaryPayload.title,
          posterUrl: summaryPayload.posterUrl,
          backdropUrl: summaryPayload.backdropUrl,
          year: summaryPayload.year,
          rating: summaryPayload.rating,
          details,
        });
        setSavedOffline(true);
        showToast('Salvo no cache offline por 7 dias');
      }
    } catch {
      showToast('Erro ao salvar no cache offline');
    } finally {
      setSavingOffline(false);
    }
  };

  // Direct share link straight to the exact movie or series episode
  const handleShare = async () => {
    const shareUrl =
      request.mediaType === 'tv'
        ? `${window.location.origin}/serie/${request.tmdbId}?s=${request.seasonNumber || 1}&e=${request.episodeNumber || 1}&play=1`
        : `${window.location.origin}/filme/${request.tmdbId}?play=1`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${summaryPayload.title} · MOVIX`,
          text: `Assistir ${summaryPayload.title} no MOVIX`,
          url: shareUrl,
        });
        return;
      }
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        showToast(t.directLinkCopied);
      }
    } catch {
      // User cancelled share
    }
  };

  const handleCycleServer = () => {
    if (safeMirrors.length > 1) {
      const nextIdx = (mirrorIdx + 1) % safeMirrors.length;
      setMirrorIdx(nextIdx);
      showToast(`Servidor alterado: ${safeMirrors[nextIdx].label}`);
    } else if (request.trailerKey) {
      setMode((m) => (m === 'trailer' ? (request.megambdStreamUrl ? 'stream' : 'embed') : 'trailer'));
    } else {
      showToast('Transmitindo no servidor principal HD');
    }
  };

  const handleSelectLanguage = (lang: 'dublado' | 'legendado') => {
    setLanguage(lang);
    setSubtitlesOn(lang === 'legendado');
    if (safeMirrors.length > 1) {
      setMirrorIdx(lang === 'dublado' ? 0 : 1);
    }
    showToast(lang === 'dublado' ? `${t.audioLanguage}: ${t.dubbed}` : `${t.audioLanguage}: ${t.subtitled}`);
  };

  const handleNextEpisodeButton = () => {
    if (onPlayNextEpisode) {
      onPlayNextEpisode();
      return;
    }
    if (request.mediaType === 'tv' && seasonData?.episodes?.length && onSelectEpisode) {
      const idx = seasonData.episodes.findIndex((e) => e.episodeNumber === request.episodeNumber);
      const nextEp = idx >= 0 ? seasonData.episodes[idx + 1] : seasonData.episodes[0];
      if (nextEp) {
        onSelectEpisode(nextEp.seasonNumber, nextEp.episodeNumber, nextEp.name);
        return;
      }
    }
    showToast('Você está no episódio mais recente desta temporada');
  };

  const playedPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const bufferedPct = duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0;
  const isStreamActive = mode === 'stream' && Boolean(request.megambdStreamUrl) && !streamError;
  const isEmbedActive = mode === 'embed' && Boolean(activeEmbedUrl) && !request.loadingSource;
  const isTrailerActive = mode === 'trailer' && Boolean(request.trailerKey) && !request.loadingSource;

  const displayTitle = details?.title || request.title;
  const topTitleLine =
    request.mediaType === 'tv' && request.episodeNumber
      ? `${displayTitle} - Temporada ${request.seasonNumber || 1} · Ep ${request.episodeNumber}`
      : displayTitle;

  const yearLabel = details?.year || '';
  const genresLabel = details?.genres?.slice(0, 3).map((g) => g.name).join(' / ') || '';
  const ratingLabel = details?.rating && details.rating > 0 ? details.rating.toFixed(1) : '';
  const runtimeLabel =
    details?.mediaType === 'movie' && details.runtime > 0
      ? `${details.runtime} min`
      : details?.mediaType === 'tv' && details.numberOfSeasons > 0
        ? `${details.numberOfSeasons} ${details.numberOfSeasons === 1 ? 'Temp.' : 'Temps.'}`
        : '';

  const ambientBackdrop = request.backdropUrl || details?.backdropUrl || request.posterUrl || details?.posterUrl;
  const relatedItems = details?.related || [];
  const tvSeasons = details?.mediaType === 'tv' ? details.seasons : [];

  const volumePct = Math.round((muted ? 0 : volume) * 100);
  const brightnessPct = Math.round(((brightness - 0.35) / 1.05) * 100);

  return (
    <div
      className={
        isMiniPip
          ? 'fixed bottom-20 right-3 sm:bottom-6 sm:right-6 z-50 w-[272px] sm:w-[360px] rounded-2xl overflow-hidden bg-[#07090F] text-[#F6F7FB] border border-[#E5B85A]/45 shadow-[0_20px_60px_rgba(0,0,0,0.88)]'
          : `fixed inset-0 z-50 bg-[#05060A] text-[#F6F7FB] ${
              isCinemaMode ? 'overflow-hidden' : 'overflow-y-auto overscroll-contain'
            }`
      }
      role="dialog"
      aria-modal={!isMiniPip}
      aria-label={`Player MOVIX: ${displayTitle}`}
    >
      {/* Ambient Cinema Backdrop Glow (Portrait / Desktop Sheet Mode) */}
      {!isCinemaMode && !isMiniPip && ambientBackdrop && (
        <div
          aria-hidden="true"
          className="fixed inset-x-0 top-0 h-[420px] pointer-events-none overflow-hidden opacity-25"
        >
          <img
            src={ambientBackdrop}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover blur-3xl scale-110 saturate-150"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#05060A]/40 via-[#05060A]/80 to-[#05060A]" />
        </div>
      )}

      <div
        className={`relative z-10 w-full mx-auto flex flex-col ${
          isMiniPip ? '' : isCinemaMode ? 'h-full max-w-none' : 'max-w-5xl min-h-full'
        }`}
      >
        {/* CINEMA PLAYER STAGE */}
        <div
          ref={videoContainerRef}
          onMouseMove={scheduleHideControls}
          onTouchStart={handleTouchStartStage}
          onTouchMove={handleTouchMoveStage}
          onTouchEnd={handleTouchEndStage}
          className={`w-full bg-black select-none transition-all ${
            isMiniPip
              ? 'flex flex-col'
              : isCinemaMode
                ? 'fixed inset-0 z-40 h-screen w-screen flex flex-col'
                : 'sticky top-0 z-30 lg:mt-5 lg:rounded-2xl lg:overflow-hidden lg:ring-1 lg:ring-white/12 shadow-[0_24px_70px_rgba(0,0,0,0.88)]'
          }`}
        >
          {/* Compact Floating Picture-in-Picture Header Bar */}
          {isMiniPip && (
            <div className="flex items-center justify-between gap-2 px-2.5 h-9 bg-[#07090F] border-b border-white/10 shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <PictureInPicture2 className="h-3.5 w-3.5 text-[#F3C669] shrink-0" />
                <span className="text-[11px] font-semibold text-[#F6F7FB] truncate">{displayTitle}</span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsMiniPip(false)}
                  aria-label="Restaurar player"
                  title="Restaurar player"
                  className="h-7 w-7 rounded-md hover:bg-white/10 flex items-center justify-center text-[#F6F7FB] hover:text-[#F3C669] cursor-pointer transition-colors"
                >
                  <Maximize className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fechar player"
                  title="Fechar player"
                  className="h-7 w-7 rounded-md hover:bg-white/10 flex items-center justify-center text-[#9CA6BE] hover:text-white cursor-pointer transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Dedicated Slim Top Bar for Embed / Trailer (keeps iframe unobstructed while exposing Display, Antologia, PiP, Cast, Battery & Clock) */}
          {!isMiniPip && (isEmbedActive || isTrailerActive) && (
            <div className="relative z-30 flex items-center justify-between gap-2 px-2.5 sm:px-4 h-12 bg-[#07090F]/95 backdrop-blur-xl border-b border-white/[0.08] shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={handleBackAction}
                  aria-label={t.back}
                  className="h-10 w-10 -ml-1 rounded-full hover:bg-white/10 active:scale-95 flex items-center justify-center text-[#F6F7FB] cursor-pointer transition-all shrink-0"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <span className="text-sm sm:text-base font-medium text-[#F6F7FB] truncate">
                  {topTitleLine}
                </span>
              </div>

              <div className="flex items-center gap-0.5 sm:gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={openPlayerTour}
                  aria-label={tourUi.playerHelpLabel}
                  title={tourUi.playerHelpLabel}
                  className="h-9 w-9 rounded-full hover:bg-white/10 flex items-center justify-center text-[#9CA6BE] hover:text-[#F3C669] cursor-pointer transition-colors"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  data-tour="player-cast"
                  onClick={handleCycleServer}
                  aria-label="Transmitir / Servidor"
                  title={safeMirrors[mirrorIdx]?.label || 'Transmitir'}
                  className="h-10 w-10 rounded-full hover:bg-white/10 flex items-center justify-center text-[#F6F7FB] cursor-pointer transition-colors"
                >
                  <Cast className="h-4.5 w-4.5" />
                </button>

                <button
                  type="button"
                  data-tour="player-display"
                  onClick={() => setActiveDrawer((d) => (d === 'display' ? null : 'display'))}
                  aria-label="Tela, Brilho e Rotação 360°"
                  title="Tela, Brilho e Rotação 360°"
                  className={`h-10 w-10 rounded-full hover:bg-white/10 flex items-center justify-center cursor-pointer transition-colors ${
                    activeDrawer === 'display' || normalizedAngle !== 0 || aspectMode !== 'default'
                      ? 'text-[#F3C669] bg-white/10'
                      : 'text-[#F6F7FB]'
                  }`}
                >
                  <ScreenDisplayIcon className="h-5 w-5" />
                </button>

                <button
                  type="button"
                  data-tour="player-anthology"
                  onClick={() => setActiveDrawer((d) => (d === 'playlist' ? null : 'playlist'))}
                  aria-label={t.anthology}
                  title={t.playlistTitle}
                  className={`h-10 px-2.5 rounded-full hover:bg-white/10 hidden sm:inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer transition-colors ${
                    activeDrawer === 'playlist' ? 'text-[#F3C669] bg-white/10' : 'text-[#F6F7FB]'
                  }`}
                >
                  <Layers className="h-4 w-4" />
                  <span>{t.anthology}</span>
                </button>

                <button
                  type="button"
                  data-tour="player-pip"
                  onClick={() => void togglePictureInPicture()}
                  aria-label="Picture-in-Picture"
                  title="Picture-in-Picture"
                  className={`h-10 w-10 rounded-full hover:bg-white/10 flex items-center justify-center cursor-pointer transition-colors ${
                    isAnyPipActive ? 'text-[#F3C669] bg-white/10' : 'text-[#F6F7FB]'
                  }`}
                >
                  <PictureInPicture2 className="h-4.5 w-4.5" />
                </button>

                <button
                  type="button"
                  data-tour="player-fullscreen"
                  onClick={() => void toggleCinemaFullscreen()}
                  aria-label={isCinemaMode ? 'Sair do modo paisagem' : t.landscapeMode}
                  title={t.landscapeMode}
                  className="h-10 w-10 rounded-full hover:bg-white/10 flex items-center justify-center text-[#F6F7FB] cursor-pointer transition-colors"
                >
                  {isCinemaMode ? <Minimize className="h-4.5 w-4.5" /> : <Maximize className="h-4.5 w-4.5" />}
                </button>

                <div className="hidden sm:flex flex-col items-center justify-center pl-1 text-[10px] font-mono tabular-nums text-white/85 leading-tight">
                  <BatteryIndicator level={batteryLevel} charging={batteryCharging} />
                  <span className="mt-0.5">{clockText}</span>
                </div>
              </div>
            </div>
          )}

          {/* VIDEO / IFRAME VIEWPORT STAGE */}
          <div
            className={`relative w-full bg-black overflow-hidden flex items-center justify-center ${
              isCinemaMode ? 'flex-1 h-full' : 'aspect-video'
            }`}
          >
            {/* LIVE ON-SCREEN COMMENTS (DANMAKU OVERLAY) */}
            {commentsEnabled && liveComments.length > 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-14 h-36 z-20 overflow-hidden">
                {liveComments.map((item) => (
                  <div
                    key={item.id}
                    className="movix-danmaku-item absolute left-0 right-0 whitespace-nowrap"
                    style={{ top: `${item.lane * 30}px` }}
                  >
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/55 backdrop-blur-md border border-white/10 text-xs sm:text-sm font-medium text-[#F6F7FB] shadow-lg">
                      <span className="text-[#F3C669] font-semibold">{item.author}:</span>
                      <span>{item.text}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* MOVIX ADS — Pre-Roll / Mid-Roll / Post-Roll Video & Image Ad Overlay (yields immediately if no active ad) */}
            {activePlayerAd && (
              <MovixPlayerAdOverlay
                placement={activePlayerAd}
                onDone={() => {
                  const finished = activePlayerAd;
                  setActivePlayerAd(null);
                  if (finished === 'during_playback') {
                    void videoRef.current?.play().catch(() => {});
                  } else if (finished === 'after_playback' && request.nextEpisode && onPlayNextEpisode) {
                    setNextCountdown(8);
                  }
                }}
              />
            )}

            {/* MEDIA LAYER */}
            {(isTrailerActive && request.trailerKey) || (isEmbedActive && activeEmbedUrl) ? (
              backgroundSuspended ? (
                <div className="relative w-full h-full flex flex-col items-center justify-center p-4 sm:p-6 text-center bg-[#06070B]">
                  {ambientBackdrop && (
                    <img
                      src={ambientBackdrop}
                      alt={displayTitle}
                      referrerPolicy="no-referrer"
                      className="absolute inset-0 w-full h-full object-cover opacity-25"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#06070B] via-[#06070B]/70 to-[#06070B]/40" />
                  <div className="relative z-10 flex flex-col items-center gap-2.5 max-w-sm">
                    <div className="h-12 w-12 rounded-full bg-[#090C14]/90 border border-[#E5B85A]/45 flex items-center justify-center text-[#F3C669] shadow-xl">
                      <Play className="h-5 w-5 fill-current ml-0.5" />
                    </div>
                    <p className="text-xs sm:text-sm font-semibold text-[#F6F7FB]">
                      {t.bgPausedTitle}
                    </p>
                    {!isMiniPip && (
                      <p className="text-[11px] sm:text-xs text-[#9CA6BE]">
                        {t.bgPausedHint}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setBackgroundSuspended(false)}
                      className="mt-1 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-[#D9A441] via-[#E5B85A] to-[#F4CB73] text-[#07080C] text-xs font-semibold shadow-lg hover:brightness-105 cursor-pointer transition-all"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      <span>{t.resumeWatching}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div ref={mediaSlotRef} className="relative w-full h-full flex items-center justify-center">
                  {isNativePip && docPipWindowRef.current && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 bg-[#07090F] p-4 text-center">
                      <PictureInPicture2 className="h-7 w-7 text-[#F3C669]" />
                      <p className="text-xs sm:text-sm font-semibold text-[#F6F7FB]">
                        {t.pipPlayingInWindow}
                      </p>
                      <button
                        type="button"
                        onClick={closeDocumentPip}
                        className="px-3.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-medium text-[#F6F7FB] cursor-pointer transition-colors"
                      >
                        {t.pipBringBack}
                      </button>
                    </div>
                  )}
                  <div
                    ref={mediaHostRef}
                    className={`${aspectFrameClass} transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform`}
                    style={mediaVisualStyle}
                  >
                    {isTrailerActive && request.trailerKey ? (
                      <iframe
                        ref={trailerIframeRef}
                        key={`trailer:${request.trailerKey}`}
                        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(request.trailerKey)}?autoplay=1&rel=0&enablejsapi=1&playsinline=1&modestbranding=1`}
                        title={`Trailer de ${displayTitle}`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                        allowFullScreen
                        className="w-full h-full border-0"
                      />
                    ) : (
                      <iframe
                        key={activeEmbedUrl || 'embed'}
                        src={activeEmbedUrl || ''}
                        title={`Player MOVIX: ${displayTitle}`}
                        referrerPolicy="strict-origin-when-cross-origin"
                        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                        allowFullScreen
                        className="w-full h-full border-0"
                      />
                    )}
                  </div>
                </div>
              )
            ) : isStreamActive ? (
              backgroundSuspended ? (
                <div className="relative w-full h-full flex flex-col items-center justify-center p-4 sm:p-6 text-center bg-[#06070B]">
                  {ambientBackdrop && (
                    <img
                      src={ambientBackdrop}
                      alt={displayTitle}
                      referrerPolicy="no-referrer"
                      className="absolute inset-0 w-full h-full object-cover opacity-25"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#06070B] via-[#06070B]/70 to-[#06070B]/40" />
                  <div className="relative z-10 flex flex-col items-center gap-2.5 max-w-sm">
                    <div className="h-12 w-12 rounded-full bg-[#090C14]/90 border border-[#E5B85A]/45 flex items-center justify-center text-[#F3C669] shadow-xl">
                      <Play className="h-5 w-5 fill-current ml-0.5" />
                    </div>
                    <p className="text-xs sm:text-sm font-semibold text-[#F6F7FB]">
                      {t.bgPausedTitle}
                    </p>
                    {!isMiniPip && (
                      <p className="text-[11px] sm:text-xs text-[#9CA6BE]">
                        {t.bgPausedHint}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setBackgroundSuspended(false)}
                      className="mt-1 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-[#D9A441] via-[#E5B85A] to-[#F4CB73] text-[#07080C] text-xs font-semibold shadow-lg hover:brightness-105 cursor-pointer transition-all"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      <span>{t.resumeWatching}</span>
                    </button>
                  </div>
                </div>
              ) : (
              <>
                <div
                  onClick={isMiniPip ? togglePlay : handleStageTap}
                  className="w-full h-full flex items-center justify-center cursor-pointer"
                >
                  <video
                    ref={videoRef}
                    playsInline
                    disablePictureInPicture={false}
                    onPlay={() => {
                      setPlaying(true);
                      setBuffering(false);
                      if (!isElementInNativePip(videoRef.current, docPipWindowRef.current)) {
                        clearOsMediaSession();
                      }
                    }}
                    onPause={() => {
                      setPlaying(false);
                      clearOsMediaSession();
                    }}
                    onWaiting={() => setBuffering(true)}
                    onCanPlay={() => setBuffering(false)}
                    onProgress={() => {
                      const v = videoRef.current;
                      if (v && v.buffered.length > 0) {
                        setBufferedEnd(v.buffered.end(v.buffered.length - 1));
                      }
                    }}
                    onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
                    onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
                    onEnded={() => {
                      setPlaying(false);
                      clearOsMediaSession();
                      setActivePlayerAd('after_playback');
                    }}
                    onError={() => {
                      setBuffering(false);
                      setStreamError(
                        'O navegador não conseguiu descodificar o stream ou o servidor recusou a ligação.'
                      );
                    }}
                    style={mediaVisualStyle}
                    className={`${aspectFrameClass} transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform`}
                  />
                </div>

                {/* Compact Play/Pause Overlay inside Floating Mini-PiP */}
                {isMiniPip && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlay();
                    }}
                    aria-label={playing ? 'Pausar' : 'Reproduzir'}
                    className="absolute bottom-2 right-2 z-20 h-8 w-8 rounded-full bg-black/75 border border-white/20 text-[#F3C669] flex items-center justify-center cursor-pointer shadow-lg"
                  >
                    {playing ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current ml-0.5" />}
                  </button>
                )}

                {/* Buffering Spinner */}
                {buffering && (
                  <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/25">
                    <div className="h-14 w-14 rounded-full bg-[#090C14]/85 backdrop-blur-md border border-[#E5B85A]/40 flex items-center justify-center shadow-2xl">
                      <Loader2 className="h-7 w-7 animate-spin text-[#F3C669]" />
                    </div>
                  </div>
                )}

                {/* Vertical Gesture HUD (Left = Brightness, Right = Volume) */}
                {gestureHud && (
                  <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 px-5 py-3 rounded-2xl bg-[#080B12]/90 backdrop-blur-xl border border-white/15 flex items-center gap-3 shadow-2xl min-w-[190px]">
                    {gestureHud.kind === 'brightness' ? (
                      <Sun className="h-5 w-5 text-[#F3C669] shrink-0" />
                    ) : gestureHud.pct === 0 ? (
                      <VolumeX className="h-5 w-5 text-[#F3C669] shrink-0" />
                    ) : (
                      <Volume2 className="h-5 w-5 text-[#F3C669] shrink-0" />
                    )}
                    <div className="flex-1 h-1.5 rounded-full bg-white/20 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#D9A441] to-[#F4CB73]"
                        style={{ width: `${Math.max(0, Math.min(100, gestureHud.pct))}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono tabular-nums font-semibold text-white w-9 text-right">
                      {Math.max(0, Math.min(100, gestureHud.pct))}%
                    </span>
                  </div>
                )}

                {/* Double-Tap Seek HUD */}
                {seekHud && (
                  <div
                    className={`pointer-events-none absolute top-1/2 -translate-y-1/2 z-20 px-4 py-2.5 rounded-full bg-black/75 backdrop-blur-md border border-[#E5B85A]/45 text-sm font-mono font-bold text-[#F3C669] shadow-xl ${
                      seekHud.side === 'left' ? 'left-10 sm:left-16' : 'right-10 sm:right-16'
                    }`}
                  >
                    {seekHud.label}
                  </div>
                )}

                {/* LEFT-CENTER FLOATING LOCK CIRCLE (Exact Screenshot Position — Visible Alone When Locked!) */}
                {!isMiniPip && (
                  <div
                    className={`absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 z-30 transition-opacity duration-200 ${
                      controlsVisible || !playing ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
                  >
                    <button
                      type="button"
                      data-tour="player-lock"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = !controlsLocked;
                        setControlsLocked(next);
                        if (next) setActiveDrawer(null);
                        showToast(next ? t.lockControls : t.unlockControls);
                      }}
                      aria-label={controlsLocked ? t.unlockControls : t.lockControls}
                      title={controlsLocked ? t.unlockControls : t.lockControls}
                      className={`h-11 w-11 rounded-full backdrop-blur-xl flex items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.55)] cursor-pointer active:scale-95 transition-all ${
                        controlsLocked
                          ? 'bg-[#E5B85A]/20 border border-[#E5B85A]/65 text-[#F3C669]'
                          : 'bg-black/50 hover:bg-black/70 border border-white/15 text-white'
                      }`}
                    >
                      {controlsLocked ? <Lock className="h-5 w-5" /> : <Unlock className="h-5 w-5" />}
                    </button>
                  </div>
                )}

                {/* TOP CINEMA HUD BAR (Screenshot 2 & 6 Layout: < Title ... Cast | Screen [<>] | Battery + Time) */}
                {!isMiniPip && !controlsLocked && (
                  <div
                    className={`absolute inset-x-0 top-0 z-20 px-3 sm:px-5 pt-3 pb-12 bg-gradient-to-b from-black/90 via-black/45 to-transparent flex items-center justify-between gap-3 transition-opacity duration-200 ${
                      controlsVisible || !playing ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={handleBackAction}
                        aria-label={t.back}
                        className="h-10 w-10 rounded-full hover:bg-white/15 flex items-center justify-center text-white cursor-pointer shrink-0 transition-colors"
                      >
                        <ChevronLeft className="h-6 w-6" />
                      </button>
                      <span className="text-sm sm:text-base font-medium text-white truncate drop-shadow">
                        {topTitleLine}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openPlayerTour();
                        }}
                        aria-label={tourUi.playerHelpLabel}
                        title={tourUi.playerHelpLabel}
                        className="h-9 w-9 rounded-full hover:bg-white/15 flex items-center justify-center text-white/80 hover:text-[#F3C669] cursor-pointer transition-colors"
                      >
                        <HelpCircle className="h-4.5 w-4.5" />
                      </button>

                      <button
                        type="button"
                        data-tour="player-cast"
                        onClick={handleCycleServer}
                        aria-label="Transmitir"
                        title={safeMirrors[mirrorIdx]?.label || 'Transmitir'}
                        className="h-10 w-10 rounded-full hover:bg-white/15 flex items-center justify-center text-white cursor-pointer transition-colors"
                      >
                        <Cast className="h-5 w-5" />
                      </button>

                      {/* Screen / Aspect / Volume / Brightness / 360° Drawer Trigger */}
                      <button
                        type="button"
                        data-tour="player-display"
                        onClick={() => setActiveDrawer((d) => (d === 'display' ? null : 'display'))}
                        aria-label="Tela, Volume, Brilho e 360°"
                        title="Tela, Volume, Brilho e 360°"
                        className={`h-10 w-10 rounded-full hover:bg-white/15 flex items-center justify-center cursor-pointer transition-colors ${
                          activeDrawer === 'display' || normalizedAngle !== 0 || aspectMode !== 'default'
                            ? 'text-[#F3C669] bg-white/10'
                            : 'text-white'
                        }`}
                      >
                        <ScreenDisplayIcon className="h-5 w-5" />
                      </button>

                      {/* Live Battery + Clock */}
                      <div className="flex flex-col items-center justify-center pl-0.5 text-[10px] font-mono tabular-nums text-white/90 leading-tight drop-shadow">
                        <BatteryIndicator level={batteryLevel} charging={batteryCharging} />
                        <span className="mt-0.5">{clockText}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* CENTER SKIP ±10s + GOLD PLAY/PAUSE MEDALLION (Screenshot 2 & 6 Positions, Elevated!) */}
                {!isMiniPip && !controlsLocked && !buffering && !activeDrawer && (
                  <div
                    className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-7 sm:gap-12 transition-opacity duration-200 ${
                      controlsVisible || !playing ? 'opacity-100' : 'opacity-0'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        skip(-10);
                      }}
                      aria-label="-10 segundos"
                      className={`h-13 w-13 sm:h-14 sm:w-14 rounded-full bg-black/40 hover:bg-black/65 backdrop-blur-md border border-white/15 flex flex-col items-center justify-center text-white active:scale-95 transition-all cursor-pointer ${
                        controlsVisible || !playing ? 'pointer-events-auto' : 'pointer-events-none'
                      }`}
                    >
                      <RotateCcw className="h-5 w-5 sm:h-6 sm:w-6" />
                      <span className="text-[10px] font-mono font-bold leading-none -mt-0.5">10</span>
                    </button>

                    <button
                      type="button"
                      data-tour="player-seek"
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePlay();
                      }}
                      aria-label={playing ? 'Pausar' : 'Reproduzir'}
                      className={`h-15 w-15 sm:h-16 sm:w-16 rounded-full bg-gradient-to-br from-[#D9A441] via-[#E8BE63] to-[#F5D07E] text-[#07080C] shadow-[0_0_32px_rgba(229,184,90,0.45)] ring-4 ring-black/45 hover:scale-105 active:scale-95 flex items-center justify-center transition-all cursor-pointer ${
                        controlsVisible || !playing ? 'pointer-events-auto' : 'pointer-events-none'
                      }`}
                    >
                      {playing ? (
                        <Pause className="h-6 w-6 sm:h-7 sm:w-7 fill-current" />
                      ) : (
                        <Play className="h-6 w-6 sm:h-7 sm:w-7 fill-current ml-0.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        skip(10);
                      }}
                      aria-label="+10 segundos"
                      className={`h-13 w-13 sm:h-14 sm:w-14 rounded-full bg-black/40 hover:bg-black/65 backdrop-blur-md border border-white/15 flex flex-col items-center justify-center text-white active:scale-95 transition-all cursor-pointer ${
                        controlsVisible || !playing ? 'pointer-events-auto' : 'pointer-events-none'
                      }`}
                    >
                      <RotateCw className="h-5 w-5 sm:h-6 sm:w-6" />
                      <span className="text-[10px] font-mono font-bold leading-none -mt-0.5">10</span>
                    </button>
                  </div>
                )}

                {/* BOTTOM CINEMA BAR (Screenshot 2 & 6 Exact Architecture: Timeline + || >| Comments Input ... Speed | Antologia | Fullscreen) */}
                {!isMiniPip && !controlsLocked && (
                  <div
                    className={`absolute inset-x-0 bottom-0 z-20 px-3 sm:px-5 pt-12 pb-2.5 sm:pb-3.5 bg-gradient-to-t from-black/95 via-black/65 to-transparent space-y-2 transition-opacity duration-200 ${
                      controlsVisible || !playing ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
                  >
                    {/* Timeline Row: 00:40 ────●──────── 52:50 */}
                    <div className="flex items-center gap-2.5 sm:gap-3">
                      <span className="text-[11px] sm:text-xs font-mono tabular-nums text-white/95 shrink-0">
                        {formatTime(currentTime)}
                      </span>

                      <div
                        onClick={handleScrub}
                        onMouseMove={handleScrubHover}
                        onMouseLeave={() => setHoverTime(null)}
                        role="slider"
                        aria-label="Progresso do vídeo"
                        aria-valuemin={0}
                        aria-valuemax={Math.floor(duration)}
                        aria-valuenow={Math.floor(currentTime)}
                        tabIndex={0}
                        className="group/scrub relative flex-1 h-5 flex items-center cursor-pointer"
                      >
                        {hoverTime && duration > 0 && (
                          <div
                            className="hidden sm:block absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded bg-[#0A0D16]/95 border border-white/15 text-[11px] font-mono tabular-nums text-[#F3C669] shadow-lg pointer-events-none"
                            style={{ left: `${hoverTime.pct}%` }}
                          >
                            {formatTime(hoverTime.time)}
                          </div>
                        )}
                        <div className="w-full h-1 group-hover/scrub:h-1.5 transition-all rounded-full bg-white/30 overflow-hidden relative">
                          <div
                            className="absolute inset-y-0 left-0 bg-white/40"
                            style={{ width: `${bufferedPct}%` }}
                          />
                          <div
                            className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#C89333] via-[#E5B85A] to-[#F7D78C] shadow-[0_0_12px_rgba(243,198,105,0.8)]"
                            style={{ width: `${playedPct}%` }}
                          />
                        </div>
                        <div
                          className="absolute h-3.5 w-3.5 group-hover/scrub:scale-125 transition-transform rounded-full bg-white ring-2 ring-[#E5B85A] shadow-[0_0_12px_rgba(243,198,105,0.95)] -translate-x-1/2 pointer-events-none"
                          style={{ left: `${playedPct}%` }}
                        />
                      </div>

                      <span className="text-[11px] sm:text-xs font-mono tabular-nums text-white/90 shrink-0">
                        {formatTime(duration)}
                      </span>
                    </div>

                    {/* Controls Row */}
                    <div className="flex items-center justify-between gap-2">
                      {/* Left: Play/Pause, Next Episode, Comments Toggle & Live Input */}
                      <div className="flex items-center gap-1 sm:gap-2 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={togglePlay}
                          aria-label={playing ? 'Pausar' : 'Reproduzir'}
                          className="h-9 w-9 rounded-full hover:bg-white/12 flex items-center justify-center text-white hover:text-[#F3C669] cursor-pointer shrink-0 transition-colors"
                        >
                          {playing ? (
                            <Pause className="h-5 w-5 fill-current" />
                          ) : (
                            <Play className="h-5 w-5 fill-current" />
                          )}
                        </button>

                        {(request.mediaType === 'tv' || request.nextEpisode) && (
                          <button
                            type="button"
                            onClick={handleNextEpisodeButton}
                            aria-label={t.nextEpisode}
                            title={t.nextEpisode}
                            className="h-9 w-9 rounded-full hover:bg-white/12 flex items-center justify-center text-white hover:text-[#F3C669] cursor-pointer shrink-0 transition-colors"
                          >
                            <SkipForward className="h-5 w-5 fill-current" />
                          </button>
                        )}

                        <button
                          type="button"
                          data-tour="player-comments"
                          onClick={() => {
                            const next = !commentsEnabled;
                            setCommentsEnabled(next);
                            showToast(next ? t.commentsOn : t.commentsOff);
                          }}
                          aria-label="Comentários na tela"
                          className={`h-9 w-9 rounded-full hover:bg-white/12 flex items-center justify-center cursor-pointer shrink-0 transition-colors ${
                            commentsEnabled ? 'text-[#F3C669]' : 'text-white/50'
                          }`}
                        >
                          <MessageSquareText className="h-5 w-5" />
                        </button>

                        {/* Live On-Screen Comment Pill (Visible in Landscape / Desktop) */}
                        <form
                          onSubmit={handleSendLiveComment}
                          onClick={(e) => e.stopPropagation()}
                          className="hidden sm:flex items-center gap-1.5 flex-1 max-w-[230px] h-8 px-2.5 rounded-lg bg-white/12 border border-white/12 focus-within:border-[#E5B85A]/60 backdrop-blur-md"
                        >
                          <input
                            type="text"
                            value={commentDraft}
                            onFocus={() => setCommentFocused(true)}
                            onBlur={() => setCommentFocused(false)}
                            onChange={(e) => setCommentDraft(e.target.value)}
                            placeholder={t.commentPlaceholder}
                            maxLength={90}
                            className="w-full bg-transparent text-xs text-white placeholder:text-white/60 focus:outline-none"
                          />
                          {commentDraft.trim() && (
                            <button
                              type="submit"
                              aria-label="Enviar comentário"
                              className="text-[#F3C669] hover:text-white cursor-pointer shrink-0"
                            >
                              <Send className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </form>
                      </div>

                      {/* Right: Speed, Antologia (Playlist), PiP, Fullscreen */}
                      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                        <button
                          type="button"
                          data-tour="player-speed"
                          onClick={() => setActiveDrawer((d) => (d === 'speed' ? null : 'speed'))}
                          className={`h-8 sm:h-9 px-2.5 sm:px-3 rounded-lg border inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer transition-colors whitespace-nowrap ${
                            activeDrawer === 'speed' || playbackRate !== 1
                              ? 'bg-[#E5B85A]/15 border-[#E5B85A]/60 text-[#F3C669]'
                              : 'bg-black/40 hover:bg-white/10 border-white/30 text-white'
                          }`}
                        >
                          <Gauge className="h-3.5 w-3.5" />
                          <span className="tabular-nums">
                            {playbackRate === 1 ? t.speedShort : `${playbackRate}x`}
                          </span>
                        </button>

                        <button
                          type="button"
                          data-tour="player-anthology"
                          onClick={() => setActiveDrawer((d) => (d === 'playlist' ? null : 'playlist'))}
                          className={`h-8 sm:h-9 px-2.5 sm:px-3 rounded-lg border inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer transition-colors whitespace-nowrap ${
                            activeDrawer === 'playlist'
                              ? 'bg-[#E5B85A]/15 border-[#E5B85A]/60 text-[#F3C669]'
                              : 'bg-black/40 hover:bg-white/10 border-white/30 text-white'
                          }`}
                        >
                          <Layers className="h-3.5 w-3.5" />
                          <span>{t.anthology}</span>
                        </button>

                        <button
                          type="button"
                          data-tour="player-pip"
                          onClick={() => void togglePictureInPicture()}
                          aria-label="Picture-in-Picture"
                          title="Picture-in-Picture"
                          className={`flex h-9 w-9 rounded-full hover:bg-white/12 items-center justify-center cursor-pointer transition-colors ${
                            isAnyPipActive
                              ? 'text-[#F3C669] bg-[#E5B85A]/15'
                              : 'text-white/90 hover:text-[#F3C669]'
                          }`}
                        >
                          <PictureInPicture2 className="h-4 w-4" />
                        </button>

                        <button
                          type="button"
                          data-tour="player-fullscreen"
                          onClick={() => void toggleCinemaFullscreen()}
                          aria-label={isCinemaMode ? 'Sair de ecrã inteiro' : t.landscapeMode}
                          className="h-9 w-9 rounded-full hover:bg-white/12 flex items-center justify-center text-white hover:text-[#F3C669] cursor-pointer transition-colors"
                        >
                          {isCinemaMode ? (
                            <Minimize className="h-4.5 w-4.5" />
                          ) : (
                            <Maximize className="h-4.5 w-4.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {nextCountdown !== null && request.nextEpisode && (
                  <div className="absolute inset-0 z-30 bg-[#040509]/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
                    <p className="text-xs uppercase tracking-widest text-[#F3C669] font-semibold mb-1.5">
                      {t.nextEpisode} · {nextCountdown}s
                    </p>
                    <h4 className="text-lg sm:text-xl font-display font-bold text-[#F6F7FB] mb-5 max-w-md text-balance">
                      T{request.nextEpisode.seasonNumber} E{request.nextEpisode.episodeNumber} ·{' '}
                      {request.nextEpisode.episodeTitle}
                    </h4>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={onPlayNextEpisode}
                        className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#D9A441] to-[#F3C669] text-[#07080C] text-xs sm:text-sm font-semibold cursor-pointer"
                      >
                        Reproduzir Agora
                      </button>
                      <button
                        type="button"
                        onClick={() => setNextCountdown(null)}
                        className="px-4 py-2.5 rounded-lg border border-white/20 text-xs sm:text-sm text-[#F6F7FB] cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </>
              )
            ) : request.loadingSource ? (
              <div className="relative w-full h-full flex flex-col items-center justify-center p-6 text-center">
                <button
                  type="button"
                  onClick={handleBackAction}
                  aria-label={t.back}
                  className="absolute top-3 left-3 z-20 h-10 w-10 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white cursor-pointer"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                {(request.backdropUrl || details?.backdropUrl) && (
                  <img
                    src={request.backdropUrl || details?.backdropUrl || ''}
                    alt={displayTitle}
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover opacity-35"
                  />
                )}
                <div className="relative z-10 flex flex-col items-center gap-3">
                  <div className="h-14 w-14 rounded-full bg-[#090C14]/85 backdrop-blur-md border border-[#E5B85A]/45 flex items-center justify-center shadow-2xl">
                    <Loader2 className="h-7 w-7 animate-spin text-[#F3C669]" />
                  </div>
                  <p className="text-sm font-medium text-[#F6F7FB] drop-shadow">
                    {t.loading} {displayTitle}
                  </p>
                </div>
              </div>
            ) : (
              <div className="relative w-full h-full flex flex-col items-center justify-center p-6 text-center">
                <button
                  type="button"
                  onClick={handleBackAction}
                  aria-label={t.back}
                  className="absolute top-3 left-3 z-20 h-10 w-10 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white cursor-pointer"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <AlertCircle className="h-8 w-8 text-[#F3C669] mb-2" />
                <p className="text-sm font-semibold text-[#F6F7FB]">Fonte indisponível no momento</p>
                <p className="text-xs text-[#95A0B8] mt-1 max-w-sm">
                  {streamError || 'Tente alternar o servidor ou assistir ao trailer oficial.'}
                </p>
                <div className="flex items-center gap-2.5 mt-4">
                  {safeMirrors.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setStreamError(null);
                        setMode('embed');
                      }}
                      className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#D9A441] to-[#F3C669] text-[#07080C] text-xs font-semibold cursor-pointer"
                    >
                      Abrir Player MegamBD
                    </button>
                  )}
                  {request.trailerKey && (
                    <button
                      type="button"
                      onClick={() => setMode('trailer')}
                      className="px-4 py-2 rounded-lg bg-[#161B29] border border-white/15 text-[#F6F7FB] text-xs font-medium cursor-pointer"
                    >
                      {t.watchTrailer}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* =================================================================
                RIGHT SLIDE-OVER DRAWER 1: DISPLAY, ASPECT, VOLUME, BRIGHTNESS & 360°
                (Matches Screenshot 1 — Upgraded in Velvet Obsidian + Gold!)
               ================================================================= */}
            {activeDrawer === 'display' && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute inset-y-0 right-0 z-40 w-[min(360px,84%)] bg-[#07090F]/92 backdrop-blur-2xl border-l border-white/12 p-4 sm:p-5 flex flex-col justify-center gap-5 overflow-y-auto shadow-[-24px_0_60px_rgba(0,0,0,0.8)]"
              >
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#F3C669]">
                    Tela · Áudio · 360°
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveDrawer(null)}
                    aria-label={t.close}
                    className="h-8 w-8 rounded-full hover:bg-white/10 flex items-center justify-center text-[#95A0B8] hover:text-white cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Aspect Ratio Row: Padrão | Completo | 16:9 | 4:3 */}
                <div className="flex items-center justify-between gap-1.5">
                  {(
                    [
                      { id: 'default', label: t.aspectDefault },
                      { id: 'full', label: t.aspectFull },
                      { id: '16:9', label: '16:9' },
                      { id: '4:3', label: '4:3' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setAspectMode(opt.id);
                        showToast(`Formato: ${opt.label}`);
                      }}
                      className={`flex-1 py-2 px-2 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
                        aspectMode === opt.id
                          ? 'text-[#F3C669] bg-[#E5B85A]/15 border border-[#E5B85A]/50'
                          : 'text-white/85 hover:text-white hover:bg-white/[0.06] border border-transparent'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Volume Slider */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-[#95A0B8]">
                    <span>{t.volumeLabel}</span>
                    <span className="font-mono tabular-nums text-[#F3C669]">{volumePct}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setMuted(false);
                        setVolume((v) => Math.max(0, Number((v - 0.1).toFixed(2))));
                      }}
                      aria-label="Diminuir volume"
                      className="text-white/85 hover:text-[#F3C669] cursor-pointer shrink-0"
                    >
                      {muted || volume === 0 ? (
                        <VolumeX className="h-5 w-5" />
                      ) : (
                        <Volume1 className="h-5 w-5" />
                      )}
                    </button>
                    <div className="relative flex-1 flex items-center">
                      <div className="w-full h-1 rounded-full bg-white/20 overflow-hidden pointer-events-none">
                        <div
                          className="h-full bg-gradient-to-r from-[#D9A441] to-[#F4CB73]"
                          style={{ width: `${volumePct}%` }}
                        />
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.02}
                        value={muted ? 0 : volume}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setVolume(v);
                          if (v > 0 && muted) setMuted(false);
                        }}
                        aria-label={t.volumeLabel}
                        className="movix-cinema-range absolute inset-0 w-full h-5 cursor-pointer"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMuted(false);
                        setVolume((v) => Math.min(1, Number((v + 0.1).toFixed(2))));
                      }}
                      aria-label="Aumentar volume"
                      className="text-white/85 hover:text-[#F3C669] cursor-pointer shrink-0"
                    >
                      <Volume2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {/* Brightness Slider */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-[#95A0B8]">
                    <span>{t.brightness}</span>
                    <span className="font-mono tabular-nums text-[#F3C669]">{brightnessPct}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setBrightness((b) => Math.max(0.35, Number((b - 0.1).toFixed(2))))}
                      aria-label="Diminuir brilho"
                      className="text-white/85 hover:text-[#F3C669] cursor-pointer shrink-0"
                    >
                      <SunDim className="h-5 w-5" />
                    </button>
                    <div className="relative flex-1 flex items-center">
                      <div className="w-full h-1 rounded-full bg-white/20 overflow-hidden pointer-events-none">
                        <div
                          className="h-full bg-gradient-to-r from-[#D9A441] to-[#F4CB73]"
                          style={{ width: `${brightnessPct}%` }}
                        />
                      </div>
                      <input
                        type="range"
                        min={0.35}
                        max={1.4}
                        step={0.02}
                        value={brightness}
                        onChange={(e) => setBrightness(Number(e.target.value))}
                        aria-label={t.brightness}
                        className="movix-cinema-range absolute inset-0 w-full h-5 cursor-pointer"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setBrightness((b) => Math.min(1.4, Number((b + 0.1).toFixed(2))))}
                      aria-label="Aumentar brilho"
                      className="text-white/85 hover:text-[#F3C669] cursor-pointer shrink-0"
                    >
                      <Sun className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {/* 360° Rotation & Mirror Precision Controls */}
                <div className="space-y-2.5 pt-2 border-t border-white/[0.08]">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#F6F7FB]">
                      <RotateCw className="h-3.5 w-3.5 text-[#F3C669]" />
                      <span>{t.rotate360}</span>
                    </span>
                    <span className="text-xs font-mono tabular-nums font-semibold text-[#F3C669]">
                      {normalizedAngle}°
                    </span>
                  </div>

                  <div className="relative flex items-center">
                    <div className="w-full h-1 rounded-full bg-white/20 overflow-hidden pointer-events-none">
                      <div
                        className="h-full bg-gradient-to-r from-[#D9A441] to-[#F4CB73]"
                        style={{ width: `${(rotationDeg / 360) * 100}%` }}
                      />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={360}
                      step={1}
                      value={rotationDeg}
                      onChange={(e) => setRotationDeg(Number(e.target.value))}
                      aria-label={t.rotate360}
                      className="movix-cinema-range absolute inset-0 w-full h-5 cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-1.5">
                    {ROTATION_PRESETS.map((deg) => (
                      <button
                        key={deg}
                        type="button"
                        onClick={() => setRotationDeg(deg)}
                        className={`flex-1 py-1.5 rounded-md text-[11px] font-mono tabular-nums font-semibold cursor-pointer transition-colors ${
                          normalizedAngle === deg
                            ? 'bg-gradient-to-r from-[#D9A441] to-[#F4CB73] text-[#07080C]'
                            : 'bg-white/[0.07] text-[#D1D7E6] hover:bg-white/15'
                        }`}
                      >
                        {deg}°
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setMirrored((m) => !m)}
                      title={t.mirrorScreen}
                      aria-label={t.mirrorScreen}
                      className={`px-2.5 py-1.5 rounded-md border cursor-pointer transition-colors ${
                        mirrored
                          ? 'bg-[#E5B85A]/20 border-[#E5B85A]/55 text-[#F3C669]'
                          : 'bg-white/[0.07] border-transparent text-[#D1D7E6] hover:bg-white/15'
                      }`}
                    >
                      <FlipHorizontal2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* =================================================================
                RIGHT SLIDE-OVER DRAWER 2: LISTA DE REPRODUÇÃO / ANTOLOGIA
                (Matches Screenshot 3 — Numbered Grid + Animated Equalizer!)
               ================================================================= */}
            {activeDrawer === 'playlist' && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute inset-y-0 right-0 z-40 w-[min(340px,82%)] bg-[#07090F]/92 backdrop-blur-2xl border-l border-white/12 p-4 sm:p-5 flex flex-col gap-3.5 overflow-y-auto shadow-[-24px_0_60px_rgba(0,0,0,0.8)]"
              >
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5">
                  <h3 className="font-display text-sm sm:text-base font-bold text-[#F6F7FB]">
                    {t.playlistTitle}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveDrawer(null)}
                    aria-label={t.close}
                    className="h-8 w-8 rounded-full hover:bg-white/10 flex items-center justify-center text-[#95A0B8] hover:text-white cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {request.mediaType === 'tv' && tvSeasons.length > 0 ? (
                  <>
                    {/* Season Tabs */}
                    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
                      {tvSeasons.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSelectedSeason(s.seasonNumber)}
                          className={`px-3 py-1 rounded-md text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                            selectedSeason === s.seasonNumber
                              ? 'bg-[#E5B85A]/20 border border-[#E5B85A]/55 text-[#F3C669]'
                              : 'bg-white/[0.06] text-[#9CA6BE] hover:text-white'
                          }`}
                        >
                          T{s.seasonNumber}
                        </button>
                      ))}
                    </div>

                    {/* 4-Column Numbered Grid (Exact Screenshot 3 Layout + Gold Active Equalizer) */}
                    {seasonData && seasonData.episodes.length > 0 ? (
                      <div className="grid grid-cols-4 gap-2">
                        {seasonData.episodes.map((ep) => {
                          const isCurrent =
                            request.seasonNumber === ep.seasonNumber &&
                            request.episodeNumber === ep.episodeNumber;
                          return (
                            <button
                              key={ep.id}
                              type="button"
                              onClick={() => {
                                onSelectEpisode?.(ep.seasonNumber, ep.episodeNumber, ep.name);
                                setActiveDrawer(null);
                              }}
                              title={`Ep ${ep.episodeNumber} · ${ep.name}`}
                              className={`relative aspect-square rounded-lg flex items-center justify-center font-mono tabular-nums text-sm font-semibold transition-all cursor-pointer ${
                                isCurrent
                                  ? 'bg-[#E5B85A]/15 border border-[#E5B85A] text-[#F3C669] shadow-[0_0_18px_rgba(229,184,90,0.25)]'
                                  : 'bg-[#1D2230]/85 hover:bg-[#272E42] border border-white/[0.05] text-[#E5E7EB]'
                              }`}
                            >
                              <span>{ep.episodeNumber}</span>
                              {isCurrent && (
                                <span
                                  className="absolute bottom-1.5 right-1.5 flex items-end gap-[2px] h-2.5"
                                  aria-hidden="true"
                                >
                                  <span className="movix-eq-bar-1 w-[2px] h-full bg-[#F3C669] rounded-full" />
                                  <span className="movix-eq-bar-2 w-[2px] h-full bg-[#F3C669] rounded-full" />
                                  <span className="movix-eq-bar-3 w-[2px] h-full bg-[#F3C669] rounded-full" />
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="py-6 flex items-center justify-center gap-2 text-xs text-[#95A0B8]">
                        <Loader2 className="h-4 w-4 animate-spin text-[#F3C669]" />
                        <span>{t.loading}</span>
                      </div>
                    )}

                    {request.episodeTitle && (
                      <p className="text-xs text-[#A0A8BC] pt-1 border-t border-white/[0.06] truncate">
                        Ep. {request.episodeNumber} · <span className="text-white">{request.episodeTitle}</span>
                      </p>
                    )}
                  </>
                ) : (
                  /* For Movies: Audio + Servers + Quick Related Selection */
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-[#95A0B8]">{t.audioLanguage}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleSelectLanguage('dublado')}
                          className={`py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                            language === 'dublado'
                              ? 'bg-gradient-to-r from-[#D9A441] to-[#F3C669] text-[#07080C]'
                              : 'bg-white/[0.07] text-[#D1D7E6]'
                          }`}
                        >
                          {t.dubbed}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectLanguage('legendado')}
                          className={`py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                            language === 'legendado'
                              ? 'bg-gradient-to-r from-[#D9A441] to-[#F3C669] text-[#07080C]'
                              : 'bg-white/[0.07] text-[#D1D7E6]'
                          }`}
                        >
                          {t.subtitled}
                        </button>
                      </div>
                    </div>

                    {relatedItems.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-[#95A0B8]">{t.youMayLike}</p>
                        <div className="space-y-2">
                          {relatedItems.slice(0, 6).map((rel) => (
                            <button
                              key={`${rel.mediaType}-${rel.id}`}
                              type="button"
                              onClick={() => {
                                setActiveDrawer(null);
                                onSelectMedia?.(rel);
                              }}
                              className="w-full flex items-center gap-2.5 p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] text-left cursor-pointer transition-colors"
                            >
                              {rel.posterUrl ? (
                                <img
                                  src={rel.posterUrl}
                                  alt={rel.title}
                                  referrerPolicy="no-referrer"
                                  className="w-10 h-14 rounded object-cover shrink-0"
                                />
                              ) : (
                                <div className="w-10 h-14 rounded bg-[#141926] flex items-center justify-center shrink-0">
                                  <Film className="h-4 w-4 text-[#F3C669]/60" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-white truncate">{rel.title}</p>
                                <p className="text-[11px] text-[#95A0B8] tabular-nums">
                                  {rel.year} {rel.rating > 0 ? `· ★ ${rel.rating.toFixed(1)}` : ''}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* =================================================================
                RIGHT SLIDE-OVER DRAWER 3: PLAYBACK SPEED
               ================================================================= */}
            {activeDrawer === 'speed' && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute inset-y-0 right-0 z-40 w-[min(240px,70%)] bg-[#07090F]/92 backdrop-blur-2xl border-l border-white/12 p-4 sm:p-5 flex flex-col justify-center gap-2 shadow-[-24px_0_60px_rgba(0,0,0,0.8)]"
              >
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5 mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#F3C669]">
                    {t.playbackSpeed}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveDrawer(null)}
                    aria-label={t.close}
                    className="h-8 w-8 rounded-full hover:bg-white/10 flex items-center justify-center text-[#95A0B8] hover:text-white cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {PLAYBACK_SPEEDS.map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => {
                      setPlaybackRate(spd);
                      setActiveDrawer(null);
                      showToast(`${t.playbackSpeed}: ${spd}x`);
                    }}
                    className={`w-full py-2.5 px-4 rounded-xl text-sm font-mono tabular-nums font-semibold text-center cursor-pointer transition-all ${
                      playbackRate === spd
                        ? 'bg-[#E5B85A]/15 border border-[#E5B85A] text-[#F3C669]'
                        : 'bg-white/[0.04] hover:bg-white/10 border border-transparent text-[#E5E7EB]'
                    }`}
                  >
                    {spd.toFixed(spd % 1 === 0 ? 1 : 2)}x
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* FLOATING TOAST FEEDBACK */}
        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl bg-[#0D111C]/95 backdrop-blur-xl border border-[#E5B85A]/45 text-xs font-semibold text-[#F3C669] shadow-[0_12px_36px_rgba(0,0,0,0.65)] whitespace-nowrap">
            {toast}
          </div>
        )}

        {/* ELEVATED WATCH SHEET (Shown in Portrait / Standard Mode) */}
        {!isCinemaMode && !isMiniPip && (
          <div className="flex-1 px-4 sm:px-6 pt-5 pb-14 space-y-6">
            {/* Title + Introdução > + Clean Unboxed Metadata */}
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#F6F7FB] leading-tight text-balance">
                  {displayTitle}
                </h1>
                <button
                  type="button"
                  onClick={() => setShowIntro((s) => !s)}
                  className="inline-flex items-center gap-0.5 text-xs sm:text-sm text-[#9CA6BE] hover:text-[#F3C669] pt-1.5 shrink-0 cursor-pointer transition-colors"
                >
                  <span>{t.introduction}</span>
                  <ChevronRight
                    className={`h-4 w-4 transition-transform duration-200 ${showIntro ? 'rotate-90' : ''}`}
                  />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm text-[#8E99B2] tabular-nums">
                {yearLabel && <span>{yearLabel}</span>}
                {yearLabel && (ratingLabel || runtimeLabel || genresLabel) && (
                  <span className="text-white/25" aria-hidden="true">·</span>
                )}
                {ratingLabel && <span className="text-[#F3C669] font-semibold">★ {ratingLabel}</span>}
                {runtimeLabel && (
                  <>
                    {ratingLabel && <span aria-hidden="true">·</span>}
                    <span>{runtimeLabel}</span>
                  </>
                )}
                {genresLabel && (
                  <>
                    {(ratingLabel || runtimeLabel) && <span aria-hidden="true">·</span>}
                    <span>{genresLabel}</span>
                  </>
                )}
              </div>
            </div>

            {/* Expandable Introdução Card */}
            {showIntro && (
              <div className="rounded-2xl bg-[#0D111C]/90 border border-white/[0.08] p-4 sm:p-5 flex flex-col sm:flex-row gap-4">
                {(details?.posterUrl || request.posterUrl) && (
                  <img
                    src={details?.posterUrl || request.posterUrl || ''}
                    alt={displayTitle}
                    referrerPolicy="no-referrer"
                    className="hidden sm:block w-24 aspect-[2/3] rounded-xl object-cover shrink-0 border border-white/10"
                  />
                )}
                <div className="flex-1 min-w-0 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[#F3C669]">
                      {t.introduction}
                    </h2>
                    <button
                      type="button"
                      onClick={() => setShowIntro(false)}
                      aria-label={t.close}
                      className="text-[#8E99B2] hover:text-[#F6F7FB] cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-xs sm:text-sm text-[#C8D0E2] leading-relaxed">
                    {details?.overview || 'Sinopse indisponível para este título.'}
                  </p>
                  {details?.cast && details.cast.length > 0 && (
                    <p className="text-xs text-[#8E99B2]">
                      <strong className="text-[#D1D7E6]">Elenco:</strong>{' '}
                      {details.cast.slice(0, 6).map((c) => c.name).join(', ')}
                    </p>
                  )}
                  {(request.trailerKey || details?.trailers?.[0]?.key) && (
                    <button
                      type="button"
                      onClick={() =>
                        setMode((m) =>
                          m === 'trailer' ? (request.megambdStreamUrl ? 'stream' : 'embed') : 'trailer'
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#161B29] border border-white/10 text-xs font-medium text-[#F3C669] hover:bg-white/10 cursor-pointer"
                    >
                      <Film className="h-3.5 w-3.5" />
                      <span>{mode === 'trailer' ? 'Voltar ao Filme' : t.watchTrailer}</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Tactile Cinema Action Bar (Gostar · Download · Tela/360° · Feedback · Compartilhar) */}
            <div className="grid grid-cols-5 sm:flex sm:flex-wrap items-center gap-2 sm:gap-3 pt-1">
              <button
                type="button"
                data-tour="player-fav"
                onClick={handleToggleFav}
                className={`min-h-[56px] sm:min-w-[88px] px-2 sm:px-3.5 py-2 rounded-xl border flex flex-col items-center justify-center gap-1 text-center transition-all cursor-pointer active:scale-95 ${
                  isFav
                    ? 'bg-[#E5B85A]/12 border-[#E5B85A]/40 text-[#F3C669]'
                    : 'bg-[#0C101A]/90 border-white/[0.07] hover:border-white/15 text-[#C8D0E2] hover:text-[#F6F7FB]'
                }`}
              >
                {isFav ? <BookmarkCheck className="h-5 w-5" /> : <BookmarkPlus className="h-5 w-5" />}
                <span className="text-[11px] font-medium whitespace-nowrap">
                  {isFav ? t.liked : t.like}
                </span>
              </button>

              <button
                type="button"
                data-tour="player-offline"
                disabled={savingOffline}
                onClick={() => void handleToggleOfflineDownload()}
                className={`min-h-[56px] sm:min-w-[88px] px-2 sm:px-3.5 py-2 rounded-xl border flex flex-col items-center justify-center gap-1 text-center transition-all cursor-pointer active:scale-95 disabled:opacity-60 ${
                  savedOffline
                    ? 'bg-[#E5B85A]/12 border-[#E5B85A]/40 text-[#F3C669]'
                    : 'bg-[#0C101A]/90 border-white/[0.07] hover:border-white/15 text-[#C8D0E2] hover:text-[#F6F7FB]'
                }`}
              >
                {savingOffline ? (
                  <Loader2 className="h-5 w-5 animate-spin text-[#F3C669]" />
                ) : savedOffline ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <Download className="h-5 w-5" />
                )}
                <span className="text-[11px] font-medium whitespace-nowrap">
                  {savedOffline ? t.savedOffline : t.download}
                </span>
              </button>

              <button
                type="button"
                data-tour="player-rotate-btn"
                onClick={() => setActiveDrawer((d) => (d === 'display' ? null : 'display'))}
                className={`min-h-[56px] sm:min-w-[88px] px-2 sm:px-3.5 py-2 rounded-xl border flex flex-col items-center justify-center gap-1 text-center transition-all cursor-pointer active:scale-95 ${
                  activeDrawer === 'display' || normalizedAngle !== 0 || aspectMode !== 'default'
                    ? 'bg-[#E5B85A]/12 border-[#E5B85A]/40 text-[#F3C669]'
                    : 'bg-[#0C101A]/90 border-white/[0.07] hover:border-white/15 text-[#C8D0E2] hover:text-[#F6F7FB]'
                }`}
              >
                <RotateCw className="h-5 w-5" />
                <span className="text-[11px] font-medium whitespace-nowrap tabular-nums">
                  {normalizedAngle !== 0 ? `${normalizedAngle}°` : '360°'}
                </span>
              </button>

              <button
                type="button"
                data-tour="player-feedback"
                onClick={() => {
                  setShowFeedback((f) => !f);
                  setFeedbackSent(false);
                }}
                className={`min-h-[56px] sm:min-w-[88px] px-2 sm:px-3.5 py-2 rounded-xl border flex flex-col items-center justify-center gap-1 text-center transition-all cursor-pointer active:scale-95 ${
                  showFeedback
                    ? 'bg-[#E5B85A]/12 border-[#E5B85A]/40 text-[#F3C669]'
                    : 'bg-[#0C101A]/90 border-white/[0.07] hover:border-white/15 text-[#C8D0E2] hover:text-[#F6F7FB]'
                }`}
              >
                <HelpCircle className="h-5 w-5" />
                <span className="text-[11px] font-medium whitespace-nowrap">{t.feedback}</span>
              </button>

              <button
                type="button"
                data-tour="player-share"
                onClick={() => void handleShare()}
                className="min-h-[56px] sm:min-w-[88px] px-2 sm:px-3.5 py-2 rounded-xl border bg-[#0C101A]/90 border-white/[0.07] hover:border-[#E5B85A]/40 text-[#C8D0E2] hover:text-[#F3C669] flex flex-col items-center justify-center gap-1 text-center transition-all cursor-pointer active:scale-95"
              >
                <Share2 className="h-5 w-5" />
                <span className="text-[11px] font-medium whitespace-nowrap">{t.share}</span>
              </button>
            </div>

            {/* Inline Feedback & Server Switch Sheet */}
            {showFeedback && (
              <div className="rounded-2xl bg-[#0D111C] border border-white/[0.08] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-[#F6F7FB]">
                    Problemas na reprodução? Troque o servidor ou reporte:
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowFeedback(false)}
                    className="text-[#8E99B2] hover:text-[#F6F7FB] cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {safeMirrors.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    {safeMirrors.map((m, idx) => (
                      <button
                        key={m.url}
                        type="button"
                        onClick={() => {
                          setMirrorIdx(idx);
                          showToast(`Servidor alterado: ${m.label}`);
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border ${
                          mirrorIdx === idx
                            ? 'bg-[#E5B85A]/15 border-[#E5B85A]/45 text-[#F3C669]'
                            : 'bg-[#07090F] border-white/10 text-[#C8D0E2]'
                        }`}
                      >
                        <Server className="h-3.5 w-3.5" />
                        <span>{m.label}</span>
                      </button>
                    ))}
                  </div>
                )}
                {feedbackSent ? (
                  <p className="text-xs text-emerald-400">
                    Obrigado! O seu aviso foi registado para melhorar a reprodução.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {['Vídeo não carrega', 'Áudio sem som', 'Legenda dessincronizada'].map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => {
                          setFeedbackSent(true);
                          showToast('Feedback enviado');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-[#07090F] hover:bg-white/10 border border-white/10 text-xs text-[#C8D0E2] cursor-pointer"
                      >
                        {reason}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* LINGUAGEM (Legendado / Dublado) */}
            <section data-tour="player-audio" className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base sm:text-lg font-display font-semibold text-[#F6F7FB]">
                  {t.audioLanguage}
                </h2>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !subtitlesOn;
                      setSubtitlesOn(next);
                      showToast(next ? 'Legendas ativadas' : 'Legendas desativadas');
                    }}
                    className={`inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer transition-colors ${
                      subtitlesOn ? 'text-[#F3C669]' : 'text-[#95A0B8] hover:text-white'
                    }`}
                  >
                    <Subtitles className="h-4 w-4" />
                    <span>CC</span>
                  </button>
                  {request.nextEpisode && onPlayNextEpisode && (
                    <button
                      type="button"
                      onClick={onPlayNextEpisode}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#F3C669] hover:underline cursor-pointer"
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                      <span>{t.nextEpisode}</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:inline-flex gap-2.5 p-1 rounded-xl bg-[#0C101A] border border-white/[0.07]">
                <button
                  type="button"
                  onClick={() => handleSelectLanguage('legendado')}
                  className={`h-11 sm:min-w-[148px] px-5 rounded-lg text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    language === 'legendado'
                      ? 'bg-gradient-to-r from-[#D9A441] via-[#E5B85A] to-[#F4CB73] text-[#07080C] shadow-[0_6px_20px_rgba(229,184,90,0.3)]'
                      : 'text-[#B8C0D4] hover:text-[#F6F7FB] hover:bg-white/[0.04]'
                  }`}
                >
                  {t.subtitled}
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectLanguage('dublado')}
                  className={`h-11 sm:min-w-[148px] px-5 rounded-lg text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    language === 'dublado'
                      ? 'bg-gradient-to-r from-[#D9A441] via-[#E5B85A] to-[#F4CB73] text-[#07080C] shadow-[0_6px_20px_rgba(229,184,90,0.3)]'
                      : 'text-[#B8C0D4] hover:text-[#F6F7FB] hover:bg-white/[0.04]'
                  }`}
                >
                  {t.dubbed}
                </button>
              </div>
            </section>

            {/* EPISODES (Cinema Stills Strip for Series) */}
            {request.mediaType === 'tv' && tvSeasons.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base sm:text-lg font-display font-semibold text-[#F6F7FB]">
                    {t.episodes}
                  </h2>
                  <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                    {tvSeasons.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedSeason(s.seasonNumber)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                          selectedSeason === s.seasonNumber
                            ? 'bg-[#E5B85A]/20 border border-[#E5B85A]/50 text-[#F3C669]'
                            : 'bg-[#0E121E] border border-white/[0.06] text-[#95A0B8] hover:text-[#F6F7FB]'
                        }`}
                      >
                        T{s.seasonNumber}
                      </button>
                    ))}
                  </div>
                </div>

                {seasonData && seasonData.episodes.length > 0 && (
                  <div className="flex gap-3 overflow-x-auto scrollbar-none pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
                    {seasonData.episodes.map((ep) => {
                      const isCurrentEp =
                        request.seasonNumber === ep.seasonNumber &&
                        request.episodeNumber === ep.episodeNumber;
                      return (
                        <button
                          key={ep.id}
                          type="button"
                          onClick={() =>
                            onSelectEpisode?.(ep.seasonNumber, ep.episodeNumber, ep.name)
                          }
                          className={`group shrink-0 w-44 rounded-xl overflow-hidden border text-left transition-all cursor-pointer ${
                            isCurrentEp
                              ? 'bg-[#E5B85A]/12 border-[#E5B85A]/55 shadow-[0_8px_24px_rgba(229,184,90,0.16)]'
                              : 'bg-[#0C101A] border-white/[0.08] hover:border-[#E5B85A]/35'
                          }`}
                        >
                          <div className="relative aspect-video w-full bg-[#06070B] overflow-hidden flex items-center justify-center">
                            {ep.stillUrl ? (
                              <img
                                src={ep.stillUrl}
                                alt={ep.name}
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                              />
                            ) : (
                              <Tv className="h-5 w-5 text-[#F3C669]/50" />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                            <span className="absolute bottom-1.5 left-2 text-[11px] font-mono tabular-nums font-semibold text-white">
                              E{String(ep.episodeNumber).padStart(2, '0')}
                            </span>
                            {isCurrentEp && (
                              <span
                                className="absolute bottom-2 right-2 flex items-end gap-[2px] h-2.5"
                                aria-hidden="true"
                              >
                                <span className="movix-eq-bar-1 w-[2px] h-full bg-[#F3C669] rounded-full" />
                                <span className="movix-eq-bar-2 w-[2px] h-full bg-[#F3C669] rounded-full" />
                                <span className="movix-eq-bar-3 w-[2px] h-full bg-[#F3C669] rounded-full" />
                              </span>
                            )}
                          </div>
                          <div className="p-2.5">
                            <p
                              className={`text-xs font-medium truncate ${
                                isCurrentEp ? 'text-[#F3C669]' : 'text-[#E5E7EB]'
                              }`}
                            >
                              {ep.name}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* VOCÊ VAI GOSTAR */}
            {relatedItems.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-base sm:text-lg font-display font-semibold text-[#F6F7FB]">
                  {t.youMayLike}
                </h2>

                <div className="flex gap-3 overflow-x-auto scrollbar-none pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
                  {relatedItems.map((rel) => (
                    <button
                      key={`${rel.mediaType}-${rel.id}`}
                      type="button"
                      onClick={() => onSelectMedia?.(rel)}
                      className="group shrink-0 w-[30vw] min-w-[108px] max-w-[148px] text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[#E5B85A] rounded-xl"
                    >
                      <div className="relative aspect-[2/3] w-full rounded-xl overflow-hidden bg-[#0C101A] border border-white/[0.08] group-hover:border-[#E5B85A]/45 transition-colors">
                        {rel.posterUrl ? (
                          <img
                            src={rel.posterUrl}
                            alt={rel.title}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-200"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            {rel.mediaType === 'tv' ? (
                              <Tv className="h-7 w-7 text-[#F3C669]/60" />
                            ) : (
                              <Film className="h-7 w-7 text-[#F3C669]/60" />
                            )}
                          </div>
                        )}
                        {rel.rating > 0 && (
                          <div className="absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-6 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex justify-end">
                            <span className="text-xs font-bold tabular-nums text-[#F3C669] drop-shadow">
                              {rel.rating.toFixed(1)}
                            </span>
                          </div>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs sm:text-sm font-medium text-[#E5E7EB] group-hover:text-[#F3C669] truncate transition-colors">
                        {rel.title}
                      </p>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <GuidedSpotlightTour
        active={playerTourActive}
        steps={playerTourSteps}
        onComplete={finishPlayerTour}
        onSkipAll={finishPlayerTour}
      />
    </div>
  );
}
