import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import { getAdmStore, saveAdmStore } from './admStore.ts';
import { hashPasswordScrypt, verifyPasswordScrypt } from './auth.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const USER_AUTH_PATH = path.join(DATA_DIR, 'movix-user-credentials.json');
const USER_SESSION_COOKIE = 'movix_user_sess';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const EPHEMERAL_USER_SECRET = crypto.randomBytes(32).toString('hex');

export interface ServerUserFavorite {
  key: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterUrl: string;
  year: string;
  rating: number;
  addedAt: string;
}

interface StoredUserCredential {
  uid: string;
  displayName: string;
  email: string;
  passwordHash: string;
  preferredLanguage: string;
  favorites: ServerUserFavorite[];
  createdAt: string;
  lastLoginAt: string;
}

interface UserAuthFile {
  users: StoredUserCredential[];
}

export interface SafeServerUser {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  emailVerified: boolean;
  provider: 'password';
  authSource: 'server';
  preferredLanguage: string;
}

interface UserTokenPayload {
  role: 'user';
  uid: string;
  email: string;
  iat: number;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      publicUserSession?: {
        uid: string;
        email: string;
        token: string;
      };
    }
  }
}

let cachedFile: UserAuthFile | null = null;

// Sliding-window brute-force protection (in-memory per IP/email)
const authAttempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxAttempts = 15, windowMs = 15 * 60 * 1000): boolean {
  const now = Date.now();
  const entry = authAttempts.get(key);
  if (!entry || now >= entry.resetAt) {
    authAttempts.set(key, { count: 1, resetAt: now + windowMs });
    if (authAttempts.size > 2000) {
      for (const [k, v] of authAttempts) {
        if (now >= v.resetAt) authAttempts.delete(k);
      }
    }
    return true;
  }
  if (entry.count >= maxAttempts) {
    return false;
  }
  entry.count += 1;
  return true;
}

function getClientIp(req: Request): string {
  const forwarded = req.header('x-forwarded-for') || '';
  return (forwarded.split(',')[0] || req.ip || 'unknown').trim().slice(0, 80);
}

function getUserSigningSecret(): string {
  const envSecret = (process.env.USER_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET || '').trim();
  if (envSecret) {
    return crypto.createHash('sha256').update(`movix-user:${envSecret}`).digest('hex');
  }
  return EPHEMERAL_USER_SECRET;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadUserAuthFile(): UserAuthFile {
  if (cachedFile) return cachedFile;
  try {
    if (fs.existsSync(USER_AUTH_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(USER_AUTH_PATH, 'utf-8')) as Partial<UserAuthFile>;
      if (Array.isArray(parsed.users)) {
        cachedFile = { users: parsed.users };
        return cachedFile;
      }
    }
  } catch {
    // Fall through to fresh file
  }
  cachedFile = { users: [] };
  return cachedFile;
}

function saveUserAuthFile(): void {
  if (!cachedFile) return;
  try {
    ensureDataDir();
    const tmp = `${USER_AUTH_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cachedFile, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, USER_AUTH_PATH);
  } catch {
    // Ignore disk write failure on ephemeral environments
  }
}

function signUserToken(uid: string, email: string): string {
  const now = Date.now();
  const payload: UserTokenPayload = {
    role: 'user',
    uid,
    email,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getUserSigningSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifyUserToken(token: string): UserTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto
    .createHmac('sha256', getUserSigningSecret())
    .update(payloadB64)
    .digest('base64url');
  const a = Buffer.from(sigB64);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf-8')
    ) as UserTokenPayload;
    if (parsed.role !== 'user' || !parsed.uid || !parsed.email || typeof parsed.exp !== 'number') {
      return null;
    }
    if (Date.now() >= parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseCookieHeader(req: Request, name: string): string {
  const header = req.headers.cookie || '';
  if (!header) return '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return '';
}

function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = (req.header('x-forwarded-proto') || '').split(',')[0]?.trim().toLowerCase();
  return proto === 'https';
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  const secure = isHttpsRequest(req);
  const attrs = [
    `${USER_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    secure ? 'Secure' : '',
    secure ? 'SameSite=None' : 'SameSite=Lax',
    secure ? 'Partitioned' : '',
  ].filter(Boolean);
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req: Request, res: Response): void {
  const secure = isHttpsRequest(req);
  const attrs = [
    `${USER_SESSION_COOKIE}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    secure ? 'Secure' : '',
    secure ? 'SameSite=None' : 'SameSite=Lax',
    secure ? 'Partitioned' : '',
  ].filter(Boolean);
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function hasValidCsrfOriginOrHeader(req: Request): boolean {
  if (req.header('x-requested-with') === 'movix-auth') return true;
  const origin = req.header('origin');
  const expectedHost = (req.header('x-forwarded-host') || req.header('host') || '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  if (!origin || !expectedHost) return false;
  try {
    return new URL(origin).host.toLowerCase() === expectedHost;
  } catch {
    return false;
  }
}

function toSafeUser(record: StoredUserCredential): SafeServerUser {
  return {
    uid: record.uid,
    displayName: record.displayName,
    email: record.email,
    photoURL: '',
    emailVerified: true,
    provider: 'password',
    authSource: 'server',
    preferredLanguage: record.preferredLanguage || 'pt-BR',
  };
}

function isEmailValid(email: string): boolean {
  if (email.length < 5 || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function isUserBlockedInAdm(uid: string, email: string): boolean {
  const adm = getAdmStore();
  const match = adm.users.find(
    (u) => u.uid === uid || (u.email && u.email.toLowerCase() === email.toLowerCase())
  );
  return match?.status === 'blocked';
}

function syncUserToAdmStore(record: StoredUserCredential): void {
  const adm = getAdmStore();
  const now = new Date().toISOString();
  const existing = adm.users.find(
    (u) => u.uid === record.uid || u.email.toLowerCase() === record.email.toLowerCase()
  );
  if (existing) {
    existing.displayName = record.displayName;
    existing.preferredLanguage = record.preferredLanguage;
    existing.favoritesCount = record.favorites.length;
    existing.lastActiveAt = now;
  } else {
    adm.users.unshift({
      uid: record.uid,
      displayName: record.displayName,
      email: record.email,
      photoURL: '',
      provider: 'password',
      preferredLanguage: record.preferredLanguage || 'pt-BR',
      status: 'active',
      role: 'user',
      favoritesCount: record.favorites.length,
      watchCount: 0,
      recentTitles: [],
      createdAt: record.createdAt,
      lastActiveAt: now,
    });
    if (adm.users.length > 2000) adm.users = adm.users.slice(0, 2000);
  }
  saveAdmStore();
}

function extractRequestToken(req: Request): { token: string; fromCookie: boolean } {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return { token: bearer, fromCookie: false };
  }
  const cookieToken = parseCookieHeader(req, USER_SESSION_COOKIE);
  if (cookieToken) return { token: cookieToken, fromCookie: true };
  return { token: '', fromCookie: false };
}

export function requirePublicUser(req: Request, res: Response, next: NextFunction): void {
  const { token, fromCookie } = extractRequestToken(req);
  if (!token) {
    res.status(401).json({ error: 'Sessão de utilizador necessária.' });
    return;
  }
  if (
    fromCookie &&
    (req.method === 'POST' ||
      req.method === 'PUT' ||
      req.method === 'PATCH' ||
      req.method === 'DELETE') &&
    !hasValidCsrfOriginOrHeader(req)
  ) {
    res.status(403).json({ error: 'Origem da solicitação não autorizada.' });
    return;
  }
  const payload = verifyUserToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Sessão expirada. Inicie sessão novamente.' });
    return;
  }
  if (isUserBlockedInAdm(payload.uid, payload.email)) {
    clearSessionCookie(req, res);
    res.status(403).json({ error: 'Esta conta foi suspensa pela administração.' });
    return;
  }
  req.publicUserSession = {
    uid: payload.uid,
    email: payload.email,
    token,
  };
  next();
}

export function handlePublicUserRegister(req: Request, res: Response): void {
  const ip = getClientIp(req);
  if (!checkRateLimit(`reg:${ip}`, 12, 15 * 60 * 1000)) {
    res.status(429).json({
      code: 'auth/too-many-requests',
      error: 'Muitas tentativas. Aguarde alguns instantes.',
    });
    return;
  }

  const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';
  const rawLang =
    typeof req.body?.preferredLanguage === 'string' && req.body.preferredLanguage.trim()
      ? req.body.preferredLanguage.trim().slice(0, 12)
      : 'pt-BR';

  if (rawName.length < 2 || rawName.length > 80) {
    res.status(400).json({ error: 'Informe um nome válido (2 a 80 caracteres).' });
    return;
  }
  if (!isEmailValid(rawEmail)) {
    res.status(400).json({ code: 'auth/invalid-email', error: 'Informe um e-mail válido.' });
    return;
  }
  if (rawPassword.length < 6 || rawPassword.length > 128) {
    res.status(400).json({
      code: 'auth/weak-password',
      error: 'A senha precisa ter pelo menos 6 caracteres.',
    });
    return;
  }

  const db = loadUserAuthFile();
  const exists = db.users.some((u) => u.email === rawEmail);
  if (exists) {
    res.status(409).json({
      code: 'auth/email-already-in-use',
      error: 'Este e-mail já possui conta cadastrada. Use Iniciar sessão.',
    });
    return;
  }

  const now = new Date().toISOString();
  const uid = `usr_${crypto.randomBytes(10).toString('hex')}`;
  const record: StoredUserCredential = {
    uid,
    displayName: rawName,
    email: rawEmail,
    passwordHash: hashPasswordScrypt(rawPassword),
    preferredLanguage: rawLang,
    favorites: [],
    createdAt: now,
    lastLoginAt: now,
  };

  db.users.unshift(record);
  saveUserAuthFile();
  syncUserToAdmStore(record);

  const token = signUserToken(record.uid, record.email);
  setSessionCookie(req, res, token);

  res.status(201).json({
    ok: true,
    token,
    user: toSafeUser(record),
    favorites: [],
  });
}

export function handlePublicUserLogin(req: Request, res: Response): void {
  const ip = getClientIp(req);
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';

  if (
    !checkRateLimit(`login:${ip}`, 20, 15 * 60 * 1000) ||
    (rawEmail && !checkRateLimit(`login:${rawEmail}`, 12, 15 * 60 * 1000))
  ) {
    res.status(429).json({
      code: 'auth/too-many-requests',
      error: 'Muitas tentativas. Aguarde alguns instantes.',
    });
    return;
  }

  if (!isEmailValid(rawEmail) || !rawPassword) {
    res.status(401).json({
      code: 'auth/invalid-credential',
      error: 'E-mail ou senha incorretos.',
    });
    return;
  }

  const db = loadUserAuthFile();
  const record = db.users.find((u) => u.email === rawEmail);
  if (!record || !verifyPasswordScrypt(rawPassword, record.passwordHash)) {
    res.status(401).json({
      code: 'auth/invalid-credential',
      error: 'E-mail ou senha incorretos.',
    });
    return;
  }

  if (isUserBlockedInAdm(record.uid, record.email)) {
    res.status(403).json({
      code: 'auth/user-disabled',
      error: 'Esta conta foi suspensa pela administração.',
    });
    return;
  }

  record.lastLoginAt = new Date().toISOString();
  saveUserAuthFile();
  syncUserToAdmStore(record);

  const token = signUserToken(record.uid, record.email);
  setSessionCookie(req, res, token);

  res.json({
    ok: true,
    token,
    user: toSafeUser(record),
    favorites: record.favorites,
  });
}

export function handlePublicUserMe(req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const { token } = extractRequestToken(req);
  if (!token) {
    res.json({ authenticated: false, user: null, favorites: [] });
    return;
  }
  const payload = verifyUserToken(token);
  if (!payload) {
    clearSessionCookie(req, res);
    res.json({ authenticated: false, user: null, favorites: [] });
    return;
  }
  const db = loadUserAuthFile();
  const record = db.users.find((u) => u.uid === payload.uid && u.email === payload.email);
  if (!record || isUserBlockedInAdm(record.uid, record.email)) {
    clearSessionCookie(req, res);
    res.json({ authenticated: false, user: null, favorites: [] });
    return;
  }

  res.json({
    authenticated: true,
    token,
    user: toSafeUser(record),
    favorites: record.favorites,
  });
}

export function handlePublicUserLogout(req: Request, res: Response): void {
  const { fromCookie } = extractRequestToken(req);
  if (fromCookie && !hasValidCsrfOriginOrHeader(req)) {
    res.status(403).json({ error: 'Origem da solicitação não autorizada.' });
    return;
  }
  clearSessionCookie(req, res);
  res.json({ ok: true });
}

export function handlePublicUserUpdatePrefs(req: Request, res: Response): void {
  const session = req.publicUserSession;
  if (!session) {
    res.status(401).json({ error: 'Sessão necessária.' });
    return;
  }
  const db = loadUserAuthFile();
  const record = db.users.find((u) => u.uid === session.uid);
  if (!record) {
    res.status(404).json({ error: 'Conta não encontrada.' });
    return;
  }
  if (typeof req.body?.preferredLanguage === 'string' && req.body.preferredLanguage.trim()) {
    record.preferredLanguage = req.body.preferredLanguage.trim().slice(0, 12);
    saveUserAuthFile();
    syncUserToAdmStore(record);
  }
  res.json({ ok: true, user: toSafeUser(record) });
}

export function handlePublicUserToggleFavorite(req: Request, res: Response): void {
  const session = req.publicUserSession;
  if (!session) {
    res.status(401).json({ error: 'Sessão necessária.' });
    return;
  }
  const db = loadUserAuthFile();
  const record = db.users.find((u) => u.uid === session.uid);
  if (!record) {
    res.status(404).json({ error: 'Conta não encontrada.' });
    return;
  }

  const active = Boolean(req.body?.active);
  const mediaType = req.body?.mediaType === 'tv' ? 'tv' : 'movie';
  const tmdbId = Number(req.body?.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId < 1) {
    res.status(400).json({ error: 'ID de título inválido.' });
    return;
  }
  const key = `${mediaType}:${tmdbId}`;

  if (active) {
    const item: ServerUserFavorite = {
      key,
      tmdbId,
      mediaType,
      title: String(req.body?.title || '').trim().slice(0, 160) || 'MOVIX',
      posterUrl: String(req.body?.posterUrl || '').trim().slice(0, 500),
      year: String(req.body?.year || '').trim().slice(0, 10),
      rating: Number.isFinite(Number(req.body?.rating)) ? Number(req.body?.rating) : 0,
      addedAt: new Date().toISOString(),
    };
    record.favorites = [item, ...record.favorites.filter((f) => f.key !== key)].slice(0, 200);
  } else {
    record.favorites = record.favorites.filter((f) => f.key !== key);
  }

  saveUserAuthFile();
  syncUserToAdmStore(record);
  res.json({ ok: true, favorites: record.favorites });
}
