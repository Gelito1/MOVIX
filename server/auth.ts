import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import {
  ALL_ADMIN_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  getAdmStore,
  saveAdmStore,
  type AdminAccount,
  type AdminPermission,
  type AdminRole,
} from './admStore.ts';
import { getServerConfig } from './config.ts';
import {
  getAdminPasswordHash,
  getAdultPinHash,
  setAdminPasswordHash,
  setAdultPinHash,
} from './store.ts';

const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

function getSigningSecret(): string {
  const envSecret = (process.env.ADMIN_SESSION_SECRET ?? '').trim();
  return envSecret || EPHEMERAL_SECRET;
}

function getDefaultPrincipalEmail(): string {
  const envEmail = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  return envEmail || 'gelitontn1@gmail.com';
}

export function hashPasswordScrypt(password: string, salt?: string): string {
  const usedSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, usedSalt, 64).toString('hex');
  return `${usedSalt}:${derived}`;
}

export function verifyPasswordScrypt(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const candidateHex = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(candidateHex, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function timingSafeTextEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export interface AdminSessionContext {
  adminId: string;
  name: string;
  email: string;
  adminRole: AdminRole;
  permissions: AdminPermission[];
  iat: number;
  exp: number;
}

interface TokenPayload {
  role: 'admin' | 'adult';
  adminId?: string;
  name?: string;
  email?: string;
  adminRole?: AdminRole;
  permissions?: AdminPermission[];
  iat: number;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      adminSession?: AdminSessionContext;
    }
  }
}

function signPayload(payload: TokenPayload): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function parseVerifiedPayload(token: string, expectedRole: 'admin' | 'adult'): TokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto.createHmac('sha256', getSigningSecret()).update(payloadB64).digest('base64url');
  const a = Buffer.from(sigB64);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as TokenPayload;
    if (parsed.role !== expectedRole || typeof parsed.exp !== 'number') return null;
    if (Date.now() >= parsed.exp) return null;
    if (expectedRole === 'admin') {
      const store = getAdmStore();
      if (parsed.iat < store.revokedSessionBefore) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function issueAdminToken(account?: Pick<AdminAccount, 'id' | 'name' | 'email' | 'role' | 'permissions'>): string {
  const now = Date.now();
  return signPayload({
    role: 'admin',
    adminId: account?.id || 'principal',
    name: account?.name || 'Administrador Principal',
    email: account?.email || getDefaultPrincipalEmail(),
    adminRole: account?.role || 'super_admin',
    permissions: account?.permissions || [...ALL_ADMIN_PERMISSIONS],
    iat: now,
    exp: now + 12 * 60 * 60 * 1000,
  });
}

export function resolveAdminSession(token: string): AdminSessionContext | null {
  const payload = parseVerifiedPayload(token, 'admin');
  if (!payload) return null;

  const admStore = getAdmStore();
  if (payload.adminId && payload.adminId !== 'principal') {
    const acct = admStore.admins.find((a) => a.id === payload.adminId);
    if (!acct || !acct.active) return null;
    return {
      adminId: acct.id,
      name: acct.name,
      email: acct.email,
      adminRole: acct.role,
      permissions: acct.role === 'super_admin' ? [...ALL_ADMIN_PERMISSIONS] : acct.permissions,
      iat: payload.iat,
      exp: payload.exp,
    };
  }

  return {
    adminId: payload.adminId || 'principal',
    name: payload.name || 'Administrador Principal',
    email: payload.email || getDefaultPrincipalEmail(),
    adminRole: payload.adminRole || 'super_admin',
    permissions:
      payload.adminRole === 'super_admin' || !payload.permissions
        ? [...ALL_ADMIN_PERMISSIONS]
        : payload.permissions,
    iat: payload.iat,
    exp: payload.exp,
  };
}

export function verifyAdminToken(token: string): boolean {
  return Boolean(resolveAdminSession(token));
}

export function issueAdultToken(): string {
  const now = Date.now();
  return signPayload({ role: 'adult', iat: now, exp: now + 2 * 60 * 60 * 1000 });
}

export function verifyAdultToken(token: string): boolean {
  return Boolean(parseVerifiedPayload(token, 'adult'));
}

export function getAdminAuthStatus(req: Request) {
  const cfg = getServerConfig();
  const envConfigured = Boolean(cfg.adminPasscode);
  const storedHash = getAdminPasswordHash();
  const admStore = getAdmStore();
  const hasAccounts = admStore.admins.length > 0;
  const requiresSetup = !envConfigured && !storedHash && !hasAccounts;

  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const session = resolveAdminSession(bearer);

  return {
    authenticated: Boolean(session),
    requiresSetup,
    envPasscodeConfigured: envConfigured,
    hasMultiAdminAccounts: hasAccounts,
    admin: session
      ? {
          id: session.adminId,
          name: session.name,
          email: session.email,
          role: session.adminRole,
          permissions: session.permissions,
        }
      : null,
  };
}

export function setupInitialAdmin(
  password: string,
  name = 'Administrador Principal',
  email = getDefaultPrincipalEmail()
): { ok: boolean; token?: string; admin?: Omit<AdminAccount, 'passwordHash'>; error?: string } {
  const cfg = getServerConfig();
  const admStore = getAdmStore();
  if (cfg.adminPasscode) {
    return { ok: false, error: 'A senha de administrador já está definida via variável de ambiente ADMIN_PASSCODE.' };
  }
  if (getAdminPasswordHash() || admStore.admins.length > 0) {
    return { ok: false, error: 'O administrador inicial já foi configurado. Inicie sessão com as suas credenciais.' };
  }
  const trimmedPass = (password || '').trim();
  if (trimmedPass.length < 6) {
    return { ok: false, error: 'A senha de administrador deve ter pelo menos 6 caracteres.' };
  }
  const cleanEmail = (email || getDefaultPrincipalEmail()).trim().toLowerCase().slice(0, 140);
  const cleanName = (name || 'Administrador Principal').trim().slice(0, 80) || 'Administrador Principal';
  const hash = hashPasswordScrypt(trimmedPass);

  setAdminPasswordHash(hash);

  const account: AdminAccount = {
    id: `adm_${Date.now().toString(36)}`,
    name: cleanName,
    email: cleanEmail,
    role: 'super_admin',
    permissions: [...ROLE_DEFAULT_PERMISSIONS.super_admin],
    passwordHash: hash,
    active: true,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  admStore.admins.push(account);
  saveAdmStore();

  const { passwordHash: _ignored, ...safeAdmin } = account;
  return { ok: true, token: issueAdminToken(account), admin: safeAdmin };
}

export function loginAdmin(
  password: string,
  email?: string
): { ok: boolean; token?: string; admin?: Omit<AdminAccount, 'passwordHash'>; error?: string } {
  const cfg = getServerConfig();
  const trimmed = (password || '').trim();
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!trimmed) {
    return { ok: false, error: 'Introduza a senha de administrador.' };
  }

  // 1. Check multi-admin accounts first if email provided or accounts exist
  const admStore = getAdmStore();
  if (admStore.admins.length > 0) {
    const candidates = cleanEmail
      ? admStore.admins.filter((a) => a.email.toLowerCase() === cleanEmail)
      : admStore.admins;
    for (const acct of candidates) {
      if (verifyPasswordScrypt(trimmed, acct.passwordHash)) {
        if (!acct.active) {
          return { ok: false, error: 'Esta conta administrativa está desativada.' };
        }
        acct.lastLoginAt = new Date().toISOString();
        saveAdmStore();
        const { passwordHash: _ignored, ...safeAdmin } = acct;
        return { ok: true, token: issueAdminToken(acct), admin: safeAdmin };
      }
    }
  }

  // 2. Check configured ADMIN_PASSCODE env var (Principal Admin override)
  const principalEmail = getDefaultPrincipalEmail();
  if (cfg.adminPasscode) {
    const emailMatches = !cleanEmail || cleanEmail === principalEmail;
    if (emailMatches && timingSafeTextEqual(trimmed, cfg.adminPasscode)) {
      return {
        ok: true,
        token: issueAdminToken({
          id: 'principal',
          name: 'Administrador Principal',
          email: principalEmail,
          role: 'super_admin',
          permissions: [...ALL_ADMIN_PERMISSIONS],
        }),
        admin: {
          id: 'principal',
          name: 'Administrador Principal',
          email: principalEmail,
          role: 'super_admin',
          permissions: [...ALL_ADMIN_PERMISSIONS],
          active: true,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        },
      };
    }
  }

  // 3. Legacy single stored hash fallback (only if no multi-admin accounts exist)
  const storedHash = getAdminPasswordHash();
  if (admStore.admins.length === 0 && storedHash && verifyPasswordScrypt(trimmed, storedHash)) {
    const emailMatches = !cleanEmail || cleanEmail === principalEmail;
    if (emailMatches) {
      return {
        ok: true,
        token: issueAdminToken({
          id: 'principal',
          name: 'Administrador Principal',
          email: principalEmail,
          role: 'super_admin',
          permissions: [...ALL_ADMIN_PERMISSIONS],
        }),
        admin: {
          id: 'principal',
          name: 'Administrador Principal',
          email: principalEmail,
          role: 'super_admin',
          permissions: [...ALL_ADMIN_PERMISSIONS],
          active: true,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        },
      };
    }
  }

  if (!cfg.adminPasscode && !storedHash && admStore.admins.length === 0) {
    return { ok: false, error: 'Nenhum administrador configurado. Complete a configuração inicial primeiro.' };
  }

  return { ok: false, error: 'Credenciais de administrador incorretas.' };
}

function getFirebaseWebApiKey(): string {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as { apiKey?: string };
      if (typeof parsed.apiKey === 'string' && parsed.apiKey.trim()) {
        return parsed.apiKey.trim();
      }
    }
  } catch {
    // ignore
  }
  return '';
}

export async function loginAdminWithFirebaseIdToken(
  idToken: string
): Promise<{ ok: boolean; token?: string; admin?: Omit<AdminAccount, 'passwordHash'>; error?: string }> {
  const cleanToken = (idToken || '').trim();
  if (!cleanToken || cleanToken.length < 40) {
    return { ok: false, error: 'Token de autenticação Google/Firebase inválido.' };
  }

  const apiKey = getFirebaseWebApiKey();
  if (!apiKey) {
    return { ok: false, error: 'Autenticação Firebase não configurada no servidor.' };
  }

  try {
    const lookupRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: cleanToken }),
      }
    );

    if (!lookupRes.ok) {
      return { ok: false, error: 'Sessão Google expirada ou inválida. Tente entrar novamente.' };
    }

    const data = (await lookupRes.json()) as {
      users?: Array<{
        localId?: string;
        email?: string;
        emailVerified?: boolean;
        displayName?: string;
      }>;
    };
    const fbUser = data.users?.[0];
    const email = (fbUser?.email || '').trim().toLowerCase();
    if (!fbUser || !email || !fbUser.emailVerified) {
      return { ok: false, error: 'É necessário uma conta Google com e-mail verificado.' };
    }

    const principalEmail = getDefaultPrincipalEmail();
    const admStore = getAdmStore();
    const existingAcct = admStore.admins.find((a) => a.email.toLowerCase() === email);

    if (existingAcct) {
      if (!existingAcct.active) {
        return { ok: false, error: 'Esta conta administrativa está desativada.' };
      }
      existingAcct.lastLoginAt = new Date().toISOString();
      saveAdmStore();
      const { passwordHash: _ignored, ...safeAdmin } = existingAcct;
      return { ok: true, token: issueAdminToken(existingAcct), admin: safeAdmin };
    }

    if (email !== principalEmail) {
      return {
        ok: false,
        error: 'Esta conta não tem permissão administrativa.',
      };
    }

    const principalAccount = {
      id: 'principal',
      name: (fbUser.displayName || '').trim().slice(0, 80) || 'Administrador Principal',
      email: principalEmail,
      role: 'super_admin' as const,
      permissions: [...ALL_ADMIN_PERMISSIONS],
      active: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };

    return {
      ok: true,
      token: issueAdminToken(principalAccount),
      admin: principalAccount,
    };
  } catch {
    return { ok: false, error: 'Não foi possível validar a autenticação Google no momento.' };
  }
}

export function updateOwnAdminPassword(
  session: AdminSessionContext,
  newPassword: string,
  newEmail?: string
): { ok: boolean; admin?: Omit<AdminAccount, 'passwordHash'>; error?: string } {
  const trimmed = (newPassword || '').trim();
  if (trimmed.length < 6) {
    return { ok: false, error: 'A nova senha deve ter pelo menos 6 caracteres.' };
  }
  const targetEmail = (newEmail || session.email || getDefaultPrincipalEmail()).trim().toLowerCase().slice(0, 140);
  if (!targetEmail || !targetEmail.includes('@')) {
    return { ok: false, error: 'Introduza um e-mail válido.' };
  }

  const hash = hashPasswordScrypt(trimmed);
  const admStore = getAdmStore();
  let acct = admStore.admins.find(
    (a) => a.id === session.adminId || a.email.toLowerCase() === session.email.toLowerCase()
  );

  if (acct) {
    acct.email = targetEmail;
    acct.passwordHash = hash;
    acct.active = true;
    acct.lastLoginAt = new Date().toISOString();
  } else {
    acct = {
      id: `adm_${Date.now().toString(36)}`,
      name: session.name || 'Administrador Principal',
      email: targetEmail,
      role: session.adminRole || 'super_admin',
      permissions:
        session.adminRole === 'super_admin'
          ? [...ALL_ADMIN_PERMISSIONS]
          : [...session.permissions],
      passwordHash: hash,
      active: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    admStore.admins.push(acct);
  }

  saveAdmStore();
  const { passwordHash: _ignored, ...safeAdmin } = acct;
  return { ok: true, admin: safeAdmin };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const session = resolveAdminSession(bearer);
  if (!session) {
    res.status(401).json({ error: 'Autenticação administrativa necessária.' });
    return;
  }
  req.adminSession = session;
  next();
}

export function requireAdminPermission(permission: AdminPermission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    requireAdmin(req, res, () => {
      const session = req.adminSession;
      if (!session) {
        res.status(401).json({ error: 'Sessão inválida.' });
        return;
      }
      if (session.adminRole !== 'super_admin' && !session.permissions.includes(permission)) {
        res.status(403).json({ error: 'Sem permissão para executar esta operação.' });
        return;
      }
      next();
    });
  };
}

export function revokeAllAdminSessions(): void {
  const store = getAdmStore();
  store.revokedSessionBefore = Date.now();
  saveAdmStore();
}

// ================= ADULT (+18) PIN AUTH =================
export function getAdultAuthStatus(req: Request) {
  const envPin = (process.env.ADULT_PIN ?? '').trim();
  const storedHash = getAdultPinHash();
  const requiresSetup = !envPin && !storedHash;

  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const unlocked = verifyAdultToken(bearer);

  return {
    unlocked,
    requiresSetup,
    envPinConfigured: Boolean(envPin),
  };
}

export function setupAdultPin(pin: string, force = false): { ok: boolean; token?: string; error?: string } {
  const envPin = (process.env.ADULT_PIN ?? '').trim();
  if (envPin && !force) {
    return { ok: false, error: 'A senha de conteúdo adulto já está definida via ADULT_PIN.' };
  }
  const trimmed = (pin || '').trim();
  if (trimmed.length < 4) {
    return { ok: false, error: 'A senha +18 deve ter pelo menos 4 caracteres.' };
  }
  const hash = hashPasswordScrypt(trimmed);
  const saved = setAdultPinHash(hash, force);
  if (!saved) {
    return { ok: false, error: 'A senha +18 já foi configurada. Introduza a senha atual para desbloquear.' };
  }
  return { ok: true, token: issueAdultToken() };
}

export function unlockAdultContent(pin: string): { ok: boolean; token?: string; error?: string } {
  const envPin = (process.env.ADULT_PIN ?? '').trim();
  const trimmed = (pin || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Introduza a senha de acesso.' };
  }

  if (envPin) {
    if (timingSafeTextEqual(trimmed, envPin)) {
      return { ok: true, token: issueAdultToken() };
    }
    return { ok: false, error: 'Senha incorreta.' };
  }

  const storedHash = getAdultPinHash();
  if (!storedHash) {
    return { ok: false, error: 'Defina uma senha inicial +18 antes de desbloquear.' };
  }

  if (verifyPasswordScrypt(trimmed, storedHash)) {
    return { ok: true, token: issueAdultToken() };
  }
  return { ok: false, error: 'Senha incorreta.' };
}

export function requireAdultUnlocked(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!verifyAdultToken(bearer)) {
    res.status(401).json({ error: 'Senha necessária para aceder a Conteúdo Adulto (+18).' });
    return;
  }
  next();
}
