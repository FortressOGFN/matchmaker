import crypto from 'crypto';
import { newId } from './ids';
import { normalizePlaylist, normalizeRegion } from './playlists';

export const TICKET_TYPE = 'mms-player';

export interface TicketClaims {
  accountId: string;
  playlist: string;
  region: string;
  partyPlayerIds: string[];
  customKey?: string;
  buildId?: string;
  platform?: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface TicketRequest {
  accountId: string;
  playlist: string;
  region?: string;
  partyPlayerIds?: string[];
  customKey?: string;
  buildId?: string;
  platform?: string;
}

export interface SignedTicket {
  ticketType: typeof TICKET_TYPE;
  payload: string;
  signature: string;
}

export type TicketVerification =
  | { ok: true; claims: TicketClaims }
  | { ok: false; reason: string };

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function sign(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(`${TICKET_TYPE}.${payload}`).digest('base64url');
}

export function buildClaims(request: TicketRequest, ttlSeconds: number, now = Date.now()): TicketClaims {
  const accountId = String(request.accountId || '').trim();
  if (!accountId) throw new Error('accountId is required');
  const playlist = normalizePlaylist(request.playlist);
  if (!playlist && !request.customKey) throw new Error('playlist is required');

  const party = new Set<string>([accountId]);
  for (const id of request.partyPlayerIds || []) {
    if (typeof id === 'string' && id.trim()) party.add(id.trim());
  }

  const claims: TicketClaims = {
    accountId,
    playlist,
    region: normalizeRegion(request.region),
    partyPlayerIds: [...party],
    issuedAt: now,
    expiresAt: now + ttlSeconds * 1000,
    nonce: newId(),
  };
  if (request.customKey) claims.customKey = String(request.customKey).trim();
  if (request.buildId) claims.buildId = String(request.buildId);
  if (request.platform) claims.platform = String(request.platform);
  return claims;
}

export function signTicket(secret: string, request: TicketRequest, ttlSeconds = 300, now = Date.now()): SignedTicket {
  if (!secret) throw new Error('A ticket secret is required to sign tickets');
  const payload = encode(buildClaims(request, ttlSeconds, now));
  return { ticketType: TICKET_TYPE, payload, signature: sign(secret, payload) };
}

export function verifyTicket(secret: string, payload: string, signature: string, now = Date.now()): TicketVerification {
  if (!payload || !signature) return { ok: false, reason: 'missing ticket' };

  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'bad signature' };
  }

  let claims: TicketClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'unreadable ticket' };
  }

  if (!claims || typeof claims.accountId !== 'string' || !Array.isArray(claims.partyPlayerIds)) {
    return { ok: false, reason: 'malformed ticket' };
  }
  if (typeof claims.expiresAt !== 'number' || claims.expiresAt < now) {
    return { ok: false, reason: 'expired ticket' };
  }
  return { ok: true, claims };
}

export interface ParsedAuthorization {
  ticketType: string;
  payload: string;
  signature: string;
}

export function parseAuthorization(header: string | undefined): ParsedAuthorization | null {
  if (!header) return null;
  const parts = header.trim().split(/\s+/);
  if (parts.length < 4 || parts[0].toLowerCase() !== 'epic-signed') return null;
  return { ticketType: parts[1], payload: parts[2], signature: parts[3] };
}
