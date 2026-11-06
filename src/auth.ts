import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db';

const SECRET = process.env.SESSION_SECRET ?? 'dev-only-secret-change-me';
const COOKIE = 'ks_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // one working day

export interface User {
  id: number;
  username: string;
  name_as: string;
  role: string;
  mouza: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

export function login(res: Response, userId: number) {
  const payload = Buffer.from(JSON.stringify({ u: userId, exp: Date.now() + MAX_AGE_MS })).toString('base64url');
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS,
  });
}

export function logout(res: Response) {
  res.clearCookie(COOKIE);
}

function readSession(req: Request): User | null {
  const raw: string | undefined = req.cookies?.[COOKIE];
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (Date.now() > exp) return null;
  return (db.prepare('SELECT id, username, name_as, role, mouza FROM users WHERE id = ?').get(u) as User) ?? null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      user?: User;
    }
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = readSession(req);
  if (!user) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorised' });
    return res.redirect('/login');
  }
  res.locals.user = user;
  next();
}
