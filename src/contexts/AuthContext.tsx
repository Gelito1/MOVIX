import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { admApi } from '../lib/admApi';
import { movixApi } from '../lib/api';
import {
  auth,
  CURRENT_TERMS_VERSION,
  deleteCloudFavorite,
  ensureCloudUserRecords,
  googleProvider,
  subscribeUserFavorites,
  updateCloudPreferences,
  upsertCloudFavorite,
  type CloudUserProfile,
  type SupportedLanguage,
} from '../lib/firebase';
import { getTranslations, type Translations } from '../lib/i18n';
import {
  bindDeviceAccount,
  getDeviceAccount,
  getLanguageLabel,
  getOnboardingState,
  isSameDeviceAccount,
  isSupportedLanguage,
  requestBrowserNotifications,
  saveOnboardingState,
  type DeviceAccountRecord,
  type NotificationDecision,
  type OnboardingState,
} from '../lib/onboarding';
import {
  getSavedPushPrefs,
  initForegroundPushListener,
  refreshSavedPushPrefsFromServer,
  resetWelcomeShownFlag,
  showNativeSystemNotification,
  syncPushSubscription,
  updateDevicePushPrefs,
} from '../lib/pushNotifications';
import { getFavorites, toggleFavorite as toggleLocalFavorite } from '../lib/storage';
import type { FavoriteItem, MediaSummary, PushPrefs } from '../types/movix';

export interface MovixAuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  providerData: ReadonlyArray<{ providerId: string }>;
  authSource: 'firebase' | 'server';
}

interface ServerAuthUserPayload {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  emailVerified?: boolean;
  preferredLanguage?: string;
}

function fromFirebaseUser(u: User): MovixAuthUser {
  return {
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    photoURL: u.photoURL,
    emailVerified: u.emailVerified,
    providerData: u.providerData,
    authSource: 'firebase',
  };
}

function fromServerUser(u: ServerAuthUserPayload): MovixAuthUser {
  return {
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    photoURL: u.photoURL || null,
    emailVerified: u.emailVerified !== false,
    providerData: [{ providerId: 'password' }],
    authSource: 'server',
  };
}

function getFirebaseErrorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
}

function makeCodedError(message: string, code?: string): Error & { code?: string } {
  const err = new Error(message) as Error & { code?: string };
  if (code) err.code = code;
  return err;
}

interface AuthContextValue {
  user: MovixAuthUser | null;
  profile: CloudUserProfile | null;
  authReady: boolean;
  onboarding: OnboardingState;
  language: SupportedLanguage;
  t: Translations;
  deviceAccount: DeviceAccountRecord | null;
  cloudFavorites: FavoriteItem[];
  allFavoriteKeys: Set<string>;
  signInWithGoogle: () => Promise<MovixAuthUser>;
  registerWithEmail: (name: string, email: string, password: string) => Promise<MovixAuthUser>;
  signInWithEmail: (email: string, password: string) => Promise<MovixAuthUser>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  refreshAuthUser: () => Promise<boolean>;
  logout: () => Promise<void>;
  allowNotifications: () => Promise<NotificationDecision>;
  declineNotifications: () => void;
  acceptTerms: () => void;
  completeOnboarding: () => void;
  setPreferredLanguage: (lang: SupportedLanguage) => Promise<void>;
  toggleNotifications: () => Promise<NotificationDecision>;
  pushPrefs: PushPrefs;
  updatePushPrefs: (patch: Partial<PushPrefs>) => Promise<void>;
  toggleSyncedFavorite: (item: MediaSummary) => void;
  favoritesVersion: number;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function formatFirebaseAuthError(error: unknown): string {
  const code = getFirebaseErrorCode(error);
  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'A janela de login do Google foi fechada antes de concluir.';
    case 'auth/popup-blocked':
      return 'O navegador bloqueou a janela pop-up. Permita pop-ups para entrar com o Google.';
    case 'auth/cancelled-popup-request':
      return 'Solicitação cancelada. Tente novamente.';
    case 'auth/email-already-in-use':
      return 'Este e-mail já possui conta cadastrada. Use Iniciar sessão.';
    case 'auth/invalid-email':
      return 'Informe um e-mail válido.';
    case 'auth/weak-password':
      return 'A senha precisa ter pelo menos 6 caracteres.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'E-mail ou senha incorretos.';
    case 'auth/user-disabled':
      return 'Esta conta foi suspensa pela administração.';
    case 'auth/too-many-requests':
      return 'Muitas tentativas. Aguarde alguns instantes.';
    case 'auth/operation-not-allowed':
      return 'Não foi possível concluir o cadastro neste momento. Tente novamente ou entre com o Google.';
    case 'auth/network-request-failed':
      return 'Sem conexão com a internet.';
    default:
      return error instanceof Error
        ? error.message
        : 'Não foi possível concluir a autenticação.';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MovixAuthUser | null>(null);
  const [profile, setProfile] = useState<CloudUserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [onboarding, setOnboarding] = useState<OnboardingState>(() => getOnboardingState());
  const [deviceAccount, setDeviceAccount] = useState<DeviceAccountRecord | null>(() =>
    getDeviceAccount()
  );
  const [cloudFavorites, setCloudFavorites] = useState<FavoriteItem[]>([]);
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  const [pushPrefs, setPushPrefs] = useState<PushPrefs>(() => getSavedPushPrefs());
  const permissionPromptInFlightRef = useRef(false);
  const serverTokenRef = useRef<string | null>(null);

  const language: SupportedLanguage = onboarding.preferredLanguage;
  const t = useMemo(() => getTranslations(language), [language]);

  // Synchronize HTML lang attribute and TMDB API language whenever preferred language changes
  useEffect(() => {
    document.documentElement.lang = language;
    movixApi.setLanguage(language);
  }, [language]);

  // Automatic geolocation-based language detection on first visit (unless manually chosen)
  useEffect(() => {
    const current = getOnboardingState();
    if (current.languageManuallySelected) return;

    const GEO_CACHE_KEY = 'movix:geo_checked:v1';
    try {
      if (window.sessionStorage.getItem(GEO_CACHE_KEY)) return;
      window.sessionStorage.setItem(GEO_CACHE_KEY, '1');
    } catch {
      // Ignore sessionStorage restrictions
    }

    let cancelled = false;
    void fetch('/api/geo')
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          geo: {
            countryCode?: string | null;
            regionLanguage?: string | null;
          } | null
        ) => {
          if (cancelled || !geo) return;
          const latest = getOnboardingState();
          if (latest.languageManuallySelected) return;
          if (isSupportedLanguage(geo.regionLanguage) && geo.regionLanguage !== latest.preferredLanguage) {
            document.documentElement.lang = geo.regionLanguage;
            movixApi.setLanguage(geo.regionLanguage);
            setOnboarding(
              saveOnboardingState({
                preferredLanguage: geo.regionLanguage,
                detectedCountry: geo.countryCode || null,
              })
            );
          } else if (geo.countryCode && geo.countryCode !== latest.detectedCountry) {
            setOnboarding(saveOnboardingState({ detectedCountry: geo.countryCode }));
          }
        }
      )
      .catch(() => {
        // Keep browser timezone/locale inferred language
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize FCM + Universal SSE push listener & sync subscription across ALL browsers
  useEffect(() => {
    void initForegroundPushListener();
    const hasNativeApi = typeof window !== 'undefined' && 'Notification' in window;
    const isGrantedOrUniversal =
      typeof window !== 'undefined' &&
      ((hasNativeApi && Notification.permission === 'granted') ||
        (!hasNativeApi && onboarding.notificationsDecision !== 'denied'));

    if (isGrantedOrUniversal) {
      void syncPushSubscription({ userId: user?.uid || null }).then((res) => {
        setPushPrefs(res.prefs);
      });
    } else {
      void refreshSavedPushPrefsFromServer().then(setPushPrefs);
    }
  }, [user?.uid, onboarding.notificationsDecision]);

  // Watch Firebase Auth state + restore server-backed email session & enforce 1 account per device
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (cancelled) return;
      if (!firebaseUser) {
        // Attempt to restore a server-verified email/password session (via HttpOnly cookie or in-memory token)
        try {
          const headers: Record<string, string> = {};
          if (serverTokenRef.current) {
            headers.Authorization = `Bearer ${serverTokenRef.current}`;
          }
          const resp = await fetch('/api/auth/me', {
            credentials: 'include',
            headers,
          });
          if (!cancelled && resp.ok) {
            const data = (await resp.json()) as {
              authenticated?: boolean;
              token?: string;
              user?: ServerAuthUserPayload | null;
              favorites?: FavoriteItem[];
            };
            if (data.authenticated && data.user) {
              const bound = getDeviceAccount();
              if (
                bound &&
                !isSameDeviceAccount(bound, { uid: data.user.uid, email: data.user.email })
              ) {
                await fetch('/api/auth/logout', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'X-Requested-With': 'movix-auth' },
                }).catch(() => {});
                serverTokenRef.current = null;
              } else {
                if (data.token) serverTokenRef.current = data.token;
                const serverUser = fromServerUser(data.user);
                setUser(serverUser);
                setCloudFavorites(Array.isArray(data.favorites) ? data.favorites : []);
                if (data.user.email) {
                  setDeviceAccount(
                    bindDeviceAccount({
                      uid: data.user.uid,
                      displayName:
                        data.user.displayName || data.user.email.split('@')[0] || 'MOVIX',
                      email: data.user.email,
                      photoURL: '',
                      provider: 'password',
                    })
                  );
                }
                const currentOnboarding = getOnboardingState();
                if (!currentOnboarding.onboardingCompleted) {
                  setOnboarding(
                    saveOnboardingState({
                      termsAccepted: true,
                      termsVersion: CURRENT_TERMS_VERSION,
                      onboardingCompleted: true,
                    })
                  );
                }
                setAuthReady(true);
                return;
              }
            }
          }
        } catch {
          // Ignore network errors during passive session check
        }

        if (!cancelled) {
          setUser((prev) => (prev?.authSource === 'server' && serverTokenRef.current ? prev : null));
          setProfile(null);
          if (!serverTokenRef.current) setCloudFavorites([]);
          setAuthReady(true);
        }
        return;
      }

      const bound = getDeviceAccount();
      if (bound && !isSameDeviceAccount(bound, { uid: firebaseUser.uid, email: firebaseUser.email })) {
        // Strictly enforce single account per device
        await signOut(auth).catch(() => {});
        setUser(null);
        setProfile(null);
        setCloudFavorites([]);
        setAuthReady(true);
        return;
      }

      serverTokenRef.current = null;
      setUser(fromFirebaseUser(firebaseUser));
      setAuthReady(true);

      const provider: 'google' | 'password' = firebaseUser.providerData.some(
        (p) => p.providerId === 'google.com'
      )
        ? 'google'
        : 'password';

      if (firebaseUser.email) {
        const nextBound = bindDeviceAccount({
          uid: firebaseUser.uid,
          displayName:
            firebaseUser.displayName || firebaseUser.email.split('@')[0] || 'MOVIX',
          email: firebaseUser.email,
          photoURL: firebaseUser.photoURL || '',
          provider,
        });
        setDeviceAccount(nextBound);
      }

      // Sync public user profile metadata to MOVIX ADM (never sending passwords)
      void admApi
        .syncPublicUser({
          uid: firebaseUser.uid,
          displayName:
            firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Utilizador MOVIX',
          email: firebaseUser.email || '',
          photoURL: firebaseUser.photoURL || '',
          provider,
          preferredLanguage: getOnboardingState().preferredLanguage,
          favoritesCount: getFavorites().length,
        })
        .then(async (syncRes) => {
          if (syncRes.status === 'blocked') {
            await signOut(auth).catch(() => {});
            setUser(null);
            setProfile(null);
          }
        })
        .catch(() => {});

      const currentOnboarding = getOnboardingState();
      if (!currentOnboarding.onboardingCompleted) {
        setOnboarding(
          saveOnboardingState({
            termsAccepted: true,
            termsVersion: CURRENT_TERMS_VERSION,
            onboardingCompleted: true,
          })
        );
      }

      if (firebaseUser.emailVerified) {
        try {
          const synced = await ensureCloudUserRecords(firebaseUser, {
            displayName: firebaseUser.displayName || undefined,
            preferredLanguage: currentOnboarding.preferredLanguage,
            notificationsEnabled: currentOnboarding.notificationsDecision === 'granted',
            termsAccepted: true,
          });
          if (synced) {
            setProfile(synced);
            if (synced.preferredLanguage !== currentOnboarding.preferredLanguage) {
              movixApi.setLanguage(synced.preferredLanguage);
              setOnboarding(saveOnboardingState({ preferredLanguage: synced.preferredLanguage }));
            }
          }
        } catch {
          // Handled inside firebase.ts structured logger; keep local session active
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Subscribe to cloud favorites only when auth is ready and user is Firebase-authenticated
  useEffect(() => {
    if (!authReady || !user) {
      setCloudFavorites([]);
      return;
    }
    if (user.authSource !== 'firebase') {
      return;
    }

    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = subscribeUserFavorites(user.uid, (items) => {
        setCloudFavorites(items);
        setFavoritesVersion((v) => v + 1);
      });
    } catch {
      // Ignore if offline or unverified
    }
    return () => {
      unsubscribe?.();
    };
  }, [authReady, user]);

  const allFavoriteKeys = useMemo(() => {
    void favoritesVersion;
    const keys = new Set(getFavorites().map((f) => f.key));
    for (const item of cloudFavorites) {
      keys.add(item.key);
    }
    return keys;
  }, [cloudFavorites, favoritesVersion]);

  const signInWithGoogle = useCallback(async () => {
    const bound = getDeviceAccount();
    const result = await signInWithPopup(auth, googleProvider);
    if (bound && !isSameDeviceAccount(bound, { uid: result.user.uid, email: result.user.email })) {
      await signOut(auth).catch(() => {});
      throw new Error(getTranslations(getOnboardingState().preferredLanguage).oneAccountPerDeviceError);
    }

    const isNewAccount = !bound;
    const displayName = result.user.displayName || result.user.email?.split('@')[0] || 'MOVIX';

    if (result.user.email) {
      setDeviceAccount(
        bindDeviceAccount({
          uid: result.user.uid,
          displayName,
          email: result.user.email,
          photoURL: result.user.photoURL || '',
          provider: 'google',
        })
      );
    }
    setOnboarding(
      saveOnboardingState({
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
        onboardingCompleted: true,
      })
    );
    void showNativeSystemNotification({
      title: isNewAccount ? 'Conta criada com sucesso! 🎉' : 'Sessão iniciada no MOVIX ✅',
      body: isNewAccount
        ? `Bem-vindo(a), ${displayName}! A sua conta MOVIX está pronta para guardar favoritos e sincronizar em nuvem.`
        : `Olá, ${displayName}! Os seus favoritos e preferências foram sincronizados.`,
      targetUrl: '/',
      tag: isNewAccount ? 'movix-account-created' : 'movix-account-login',
      category: 'app_updates',
    });
    return fromFirebaseUser(result.user);
  }, []);

  const registerWithEmail = useCallback(
    async (name: string, email: string, password: string) => {
      const bound = getDeviceAccount();
      if (bound) {
        throw new Error(getTranslations(getOnboardingState().preferredLanguage).oneAccountPerDeviceError);
      }

      const cleanName = name.trim().slice(0, 80);
      const cleanEmail = email.trim();

      let signedUser: MovixAuthUser;
      try {
        const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        if (cleanName) {
          await updateProfile(cred.user, { displayName: cleanName }).catch(() => {});
        }
        await sendEmailVerification(cred.user).catch(() => {});
        signedUser = fromFirebaseUser(cred.user);
        if (cleanName && !signedUser.displayName) {
          signedUser = { ...signedUser, displayName: cleanName };
        }
      } catch (err) {
        if (getFirebaseErrorCode(err) !== 'auth/operation-not-allowed') {
          throw err;
        }
        // Seamless server-backed registration when Firebase Email/Password provider is not enabled yet
        const resp = await fetch('/api/auth/register', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'movix-auth',
          },
          body: JSON.stringify({
            name: cleanName,
            email: cleanEmail,
            password,
            preferredLanguage: getOnboardingState().preferredLanguage,
          }),
        });
        const data = (await resp.json().catch(() => ({}))) as {
          ok?: boolean;
          token?: string;
          user?: ServerAuthUserPayload;
          favorites?: FavoriteItem[];
          code?: string;
          error?: string;
        };
        if (!resp.ok || !data.user || !data.token) {
          throw makeCodedError(
            data.error || 'Não foi possível criar a conta. Tente novamente.',
            data.code
          );
        }
        serverTokenRef.current = data.token;
        signedUser = fromServerUser(data.user);
        setUser(signedUser);
        setCloudFavorites(Array.isArray(data.favorites) ? data.favorites : []);
      }

      const displayName = cleanName || cleanEmail.split('@')[0] || 'MOVIX';
      setDeviceAccount(
        bindDeviceAccount({
          uid: signedUser.uid,
          displayName,
          email: cleanEmail,
          photoURL: '',
          provider: 'password',
        })
      );
      setOnboarding(
        saveOnboardingState({
          termsAccepted: true,
          termsVersion: CURRENT_TERMS_VERSION,
          onboardingCompleted: true,
        })
      );
      void showNativeSystemNotification({
        title: 'Conta criada com sucesso! 🎉',
        body: `Bem-vindo(a), ${displayName}! A sua conta MOVIX foi criada e está pronta.`,
        targetUrl: '/',
        tag: 'movix-account-created',
        category: 'app_updates',
      });
      return signedUser;
    },
    []
  );

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const cleanEmail = email.trim();
    const bound = getDeviceAccount();
    if (bound && !isSameDeviceAccount(bound, { email: cleanEmail })) {
      throw new Error(getTranslations(getOnboardingState().preferredLanguage).oneAccountPerDeviceError);
    }

    let signedUser: MovixAuthUser;
    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
      signedUser = fromFirebaseUser(cred.user);
    } catch (err) {
      const code = getFirebaseErrorCode(err);
      const shouldTryServer =
        code === 'auth/operation-not-allowed' ||
        code === 'auth/user-not-found' ||
        code === 'auth/invalid-credential';
      if (!shouldTryServer) {
        throw err;
      }

      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'movix-auth',
        },
        body: JSON.stringify({ email: cleanEmail, password }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        token?: string;
        user?: ServerAuthUserPayload;
        favorites?: FavoriteItem[];
        code?: string;
        error?: string;
      };
      if (!resp.ok || !data.user || !data.token) {
        throw makeCodedError(
          data.error || 'E-mail ou senha incorretos.',
          data.code || 'auth/invalid-credential'
        );
      }
      serverTokenRef.current = data.token;
      signedUser = fromServerUser(data.user);
      setUser(signedUser);
      setCloudFavorites(Array.isArray(data.favorites) ? data.favorites : []);
    }

    const displayName = signedUser.displayName || signedUser.email?.split('@')[0] || 'MOVIX';
    if (signedUser.email) {
      setDeviceAccount(
        bindDeviceAccount({
          uid: signedUser.uid,
          displayName,
          email: signedUser.email,
          photoURL: signedUser.photoURL || '',
          provider: 'password',
        })
      );
    }
    setOnboarding(
      saveOnboardingState({
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
        onboardingCompleted: true,
      })
    );
    void showNativeSystemNotification({
      title: 'Sessão iniciada no MOVIX ✅',
      body: `Olá, ${displayName}! Os seus favoritos e preferências estão prontos.`,
      targetUrl: '/',
      tag: 'movix-account-login',
      category: 'app_updates',
    });
    return signedUser;
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    const cleanEmail = email.trim();
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
    } catch (err) {
      if (getFirebaseErrorCode(err) === 'auth/operation-not-allowed') {
        throw new Error(
          'A recuperação automática por e-mail ainda não está ativa. Use o login com Google ou contate o suporte MOVIX.'
        );
      }
      throw err;
    }
    void showNativeSystemNotification({
      title: 'Recuperação de senha enviada 🔐',
      body: `Verifique ${cleanEmail} para redefinir a sua senha do MOVIX.`,
      targetUrl: '/',
      tag: 'movix-password-reset',
      category: 'app_updates',
    });
  }, []);

  const resendVerificationEmail = useCallback(async () => {
    if (!auth.currentUser) return;
    await sendEmailVerification(auth.currentUser);
    void showNativeSystemNotification({
      title: 'Link de verificação enviado ✉️',
      body: `Confira a caixa de entrada de ${auth.currentUser.email || 'seu e-mail'} para confirmar a conta.`,
      targetUrl: '/',
      tag: 'movix-email-verify',
      category: 'app_updates',
    });
  }, []);

  const refreshAuthUser = useCallback(async () => {
    if (!auth.currentUser) return Boolean(user?.emailVerified);
    await auth.currentUser.reload();
    const refreshed = auth.currentUser;
    setUser(fromFirebaseUser(refreshed));
    if (refreshed.emailVerified) {
      const currentOnboarding = getOnboardingState();
      const synced = await ensureCloudUserRecords(refreshed, {
        displayName: refreshed.displayName || undefined,
        preferredLanguage: currentOnboarding.preferredLanguage,
        notificationsEnabled: currentOnboarding.notificationsDecision === 'granted',
        termsAccepted: true,
      }).catch(() => null);
      if (synced) setProfile(synced);
      void showNativeSystemNotification({
        title: 'E-mail verificado com sucesso ✅',
        body: 'A sua conta MOVIX está totalmente verificada e sincronizada na nuvem.',
        targetUrl: '/',
        tag: 'movix-email-verified',
        category: 'app_updates',
      });
    }
    return Boolean(refreshed.emailVerified);
  }, [user?.emailVerified]);

  const logout = useCallback(async () => {
    await signOut(auth).catch(() => {});
    if (serverTokenRef.current || user?.authSource === 'server') {
      const headers: Record<string, string> = { 'X-Requested-With': 'movix-auth' };
      if (serverTokenRef.current) {
        headers.Authorization = `Bearer ${serverTokenRef.current}`;
      }
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers,
      }).catch(() => {});
      serverTokenRef.current = null;
    }
    setUser(null);
    setProfile(null);
    setCloudFavorites([]);
  }, [user?.authSource]);

  const allowNotifications = useCallback(async () => {
    if (permissionPromptInFlightRef.current) {
      return getOnboardingState().notificationsDecision;
    }
    permissionPromptInFlightRef.current = true;
    try {
      const hasNativeApi = typeof window !== 'undefined' && 'Notification' in window;
      const wasGranted =
        (hasNativeApi && Notification.permission === 'granted') ||
        (!hasNativeApi && getOnboardingState().notificationsDecision === 'granted');

      // IMPORTANT: Call requestBrowserNotifications() synchronously as the VERY FIRST async step
      // so Safari, Firefox, Opera, Brave, and iOS PWA preserve the user-gesture activation token.
      const decision = await requestBrowserNotifications();

      if (decision !== null) {
        setOnboarding(saveOnboardingState({ notificationsDecision: decision }));
      }

      if (decision === 'granted') {
        const syncRes = await syncPushSubscription({
          userId: auth.currentUser?.uid || null,
          prefs: getSavedPushPrefs(),
          forceWelcome: !wasGranted,
        });
        setPushPrefs(syncRes.prefs);
      }
      if (auth.currentUser?.emailVerified && decision !== null) {
        void updateCloudPreferences(auth.currentUser, {
          notificationsEnabled: decision === 'granted',
        }).catch(() => {});
      }
      return decision;
    } finally {
      permissionPromptInFlightRef.current = false;
    }
  }, []);

  // Automatically request native OS notification permission across ALL browsers:
  // 1) Immediate auto-prompt on Chrome/Edge/Android/Samsung
  // 2) Trusted user-gesture capture (click/touchend/keydown) on Safari, Firefox, Brave, Opera, and iOS PWA
  // 3) Automatic universal real-time activation on browsers lacking window.Notification (e.g. iOS regular tab / WebView)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Browsers without Notification constructor: activate universal real-time delivery automatically
    if (!('Notification' in window)) {
      if (getOnboardingState().notificationsDecision !== 'denied') {
        void allowNotifications();
      }
      return;
    }

    if (Notification.permission !== 'default') return;

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('click', triggerOnFirstInteraction, { capture: true });
      window.removeEventListener('touchend', triggerOnFirstInteraction, { capture: true });
      window.removeEventListener('keydown', triggerOnFirstInteraction, { capture: true });
    };

    // 1. Let the first frame paint cleanly, then try automatic native permission prompt
    const timer = window.setTimeout(() => {
      if ('Notification' in window && Notification.permission === 'default') {
        void allowNotifications().then(() => {
          if ('Notification' in window && Notification.permission !== 'default') {
            cleanup();
          }
        });
      } else {
        cleanup();
      }
    }, 150);

    // 2. Trusted user-gesture fallback for Safari, Firefox, Opera, Brave, iOS PWA
    //    (click/touchend/keydown are universally valid user activations; pointerdown is NOT in Safari/Firefox)
    const triggerOnFirstInteraction = () => {
      if (typeof window === 'undefined' || !('Notification' in window)) {
        cleanup();
        return;
      }
      if (Notification.permission !== 'default') {
        cleanup();
        return;
      }
      if (permissionPromptInFlightRef.current) return;
      void allowNotifications().then(() => {
        // Keep listeners attached until the browser actually records granted or denied
        if ('Notification' in window && Notification.permission !== 'default') {
          cleanup();
        }
      });
    };

    window.addEventListener('click', triggerOnFirstInteraction, { capture: true });
    window.addEventListener('touchend', triggerOnFirstInteraction, { capture: true });
    window.addEventListener('keydown', triggerOnFirstInteraction, { capture: true });
    return cleanup;
  }, [allowNotifications]);

  const declineNotifications = useCallback(() => {
    resetWelcomeShownFlag();
    setOnboarding(saveOnboardingState({ notificationsDecision: 'denied' }));
    if (auth.currentUser?.emailVerified) {
      void updateCloudPreferences(auth.currentUser, {
        notificationsEnabled: false,
      }).catch(() => {});
    }
  }, []);

  const acceptTerms = useCallback(() => {
    setOnboarding(
      saveOnboardingState({
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
      })
    );
  }, []);

  const completeOnboarding = useCallback(() => {
    setOnboarding(
      saveOnboardingState({
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
        onboardingCompleted: true,
      })
    );
  }, []);

  const setPreferredLanguage = useCallback(async (lang: SupportedLanguage) => {
    document.documentElement.lang = lang;
    movixApi.setLanguage(lang);
    setOnboarding(
      saveOnboardingState({
        preferredLanguage: lang,
        languageManuallySelected: true,
      })
    );
    setProfile((prev) => (prev ? { ...prev, preferredLanguage: lang } : prev));
    if (auth.currentUser?.emailVerified) {
      await updateCloudPreferences(auth.currentUser, { preferredLanguage: lang }).catch(() => {});
    } else if (serverTokenRef.current) {
      await fetch('/api/auth/preferences', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'movix-auth',
          Authorization: `Bearer ${serverTokenRef.current}`,
        },
        body: JSON.stringify({ preferredLanguage: lang }),
      }).catch(() => {});
    }
    void showNativeSystemNotification({
      title: 'Idioma guardado 🌐',
      body: `O catálogo e a interface do MOVIX foram atualizados para ${getLanguageLabel(lang)}.`,
      targetUrl: '/',
      tag: 'movix-language-saved',
      category: 'app_updates',
    });
  }, []);

  const toggleNotifications = useCallback(async () => {
    const currentlyGranted = onboarding.notificationsDecision === 'granted';
    if (currentlyGranted) {
      declineNotifications();
      return 'denied' as NotificationDecision;
    }
    return allowNotifications();
  }, [onboarding.notificationsDecision, allowNotifications, declineNotifications]);

  const updatePushPrefs = useCallback(async (patch: Partial<PushPrefs>) => {
    const updated = await updateDevicePushPrefs(patch, auth.currentUser?.uid || user?.uid || null);
    setPushPrefs(updated);
    void showNativeSystemNotification({
      title: 'Preferências guardadas 🔔',
      body: 'As suas configurações de notificações do MOVIX foram guardadas com sucesso.',
      targetUrl: '/',
      tag: 'movix-push-prefs-saved',
      category: 'app_updates',
    });
  }, [user?.uid]);

  const toggleSyncedFavorite = useCallback((item: MediaSummary) => {
    const payload = {
      tmdbId: item.id,
      mediaType: item.mediaType,
      title: item.title,
      posterUrl: item.posterUrl,
      year: item.year,
      rating: item.rating,
    };
    const result = toggleLocalFavorite(payload);
    setFavoritesVersion((v) => v + 1);

    if (auth.currentUser?.emailVerified) {
      if (result.active) {
        void upsertCloudFavorite(auth.currentUser, payload).catch(() => {});
      } else {
        void deleteCloudFavorite(auth.currentUser, item.mediaType, item.id).catch(() => {});
      }
    } else if (serverTokenRef.current) {
      void fetch('/api/auth/favorites', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'movix-auth',
          Authorization: `Bearer ${serverTokenRef.current}`,
        },
        body: JSON.stringify({ ...payload, active: result.active }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { favorites?: FavoriteItem[] } | null) => {
          if (data?.favorites) {
            setCloudFavorites(data.favorites);
            setFavoritesVersion((v) => v + 1);
          }
        })
        .catch(() => {});
    }

    const detailTarget = `#/${item.mediaType === 'tv' ? 'serie' : 'filme'}/${item.id}`;
    void showNativeSystemNotification({
      title: result.active ? 'Guardado na Minha Lista ⭐' : 'Removido da Minha Lista',
      body: result.active
        ? `"${item.title}" foi guardado nos seus favoritos do MOVIX.`
        : `"${item.title}" foi removido dos seus favoritos.`,
      imageUrl: result.active ? item.posterUrl || undefined : undefined,
      targetUrl: result.active ? detailTarget : '#/minha-lista',
      tag: `movix-favorite-${item.mediaType}-${item.id}`,
      category: 'recommendations',
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      authReady,
      onboarding,
      language,
      t,
      deviceAccount,
      cloudFavorites,
      allFavoriteKeys,
      signInWithGoogle,
      registerWithEmail,
      signInWithEmail,
      sendPasswordReset,
      resendVerificationEmail,
      refreshAuthUser,
      logout,
      allowNotifications,
      declineNotifications,
      acceptTerms,
      completeOnboarding,
      setPreferredLanguage,
      toggleNotifications,
      pushPrefs,
      updatePushPrefs,
      toggleSyncedFavorite,
      favoritesVersion,
    }),
    [
      user,
      profile,
      authReady,
      onboarding,
      language,
      t,
      deviceAccount,
      cloudFavorites,
      allFavoriteKeys,
      signInWithGoogle,
      registerWithEmail,
      signInWithEmail,
      sendPasswordReset,
      resendVerificationEmail,
      refreshAuthUser,
      logout,
      allowNotifications,
      declineNotifications,
      acceptTerms,
      completeOnboarding,
      setPreferredLanguage,
      toggleNotifications,
      pushPrefs,
      updatePushPrefs,
      toggleSyncedFavorite,
      favoritesVersion,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  }
  return ctx;
}
