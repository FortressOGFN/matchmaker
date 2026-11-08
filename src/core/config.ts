import crypto from 'crypto';
import { LogLevel } from './logger';
import { normalizePlaylist, normalizeRegion } from './playlists';

export type ReadyCheck = 'probe' | 'register' | 'always';

export interface StaticServerConfig {
  ip: string;
  port: number;
  playlist: string;
  region: string;
  maxPlayers: number;
}

export interface NovaConfig {
  host: string;
  port: number;
  publicUrl: string;
  apiKey: string;
  ticketSecret: string;
  ticketTtlSeconds: number;
  allowUnsignedTickets: boolean;
  defaultRegion: string;
  strictPlaylist: boolean;
  readyCheck: ReadyCheck;
  readyDelaySeconds: number;
  probeIntervalMs: number;
  heartbeatTimeoutSeconds: number;
  tickIntervalMs: number;
  queueUpdateIntervalMs: number;
  joinDelaySeconds: number;
  reservationTtlSeconds: number;
  sessionTtlMinutes: number;
  maxQueueSize: number;
  defaultMaxPlayers: number;
  servers: StaticServerConfig[];
  logLevel: LogLevel;
}

function text(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key];
  return value !== undefined && value.trim() !== '' ? value.trim() : fallback;
}

function number(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 0): number {
  const value = Number(env[key]);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function flag(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const value = env[key]?.trim().toLowerCase();
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1' || value === 'yes';
}

export function parseServers(value: string, defaultRegion: string, defaultMaxPlayers: number): StaticServerConfig[] {
  const result: StaticServerConfig[] = [];
  for (const entry of value.split(',').map((item) => item.trim()).filter(Boolean)) {
    const [ip, portText, playlist = 'playlist_defaultsolo', region = defaultRegion, maxText] = entry.split(':');
    const port = Number(portText);
    if (!ip || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid server entry "${entry}". Use ip:port:playlist:region:maxPlayers`);
    }
    const maxPlayers = Number(maxText);
    result.push({
      ip,
      port,
      playlist: normalizePlaylist(playlist),
      region: normalizeRegion(region, defaultRegion),
      maxPlayers: Number.isInteger(maxPlayers) && maxPlayers > 0 ? maxPlayers : defaultMaxPlayers,
    });
  }
  return result;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): NovaConfig {
  const host = text(env, 'NOVA_HOST', '0.0.0.0');
  const port = number(env, 'NOVA_PORT', 8080, 1);
  const defaultRegion = normalizeRegion(text(env, 'NOVA_DEFAULT_REGION', 'NAE'));
  const defaultMaxPlayers = number(env, 'NOVA_DEFAULT_MAX_PLAYERS', 100, 1);
  const readyCheck = text(env, 'NOVA_READY_CHECK', 'probe').toLowerCase();
  const logLevel = text(env, 'NOVA_LOG_LEVEL', 'info').toLowerCase();

  return {
    host,
    port,
    publicUrl: text(env, 'NOVA_PUBLIC_URL', `ws://127.0.0.1:${port}`),
    apiKey: text(env, 'NOVA_API_KEY', ''),
    ticketSecret: text(env, 'NOVA_TICKET_SECRET', ''),
    ticketTtlSeconds: number(env, 'NOVA_TICKET_TTL_SECONDS', 300, 10),
    allowUnsignedTickets: flag(env, 'NOVA_ALLOW_UNSIGNED_TICKETS', false),
    defaultRegion,
    strictPlaylist: flag(env, 'NOVA_STRICT_PLAYLIST', true),
    readyCheck: readyCheck === 'register' || readyCheck === 'always' ? readyCheck : 'probe',
    readyDelaySeconds: number(env, 'NOVA_READY_DELAY_SECONDS', 3),
    probeIntervalMs: number(env, 'NOVA_PROBE_INTERVAL_MS', 2000, 250),
    heartbeatTimeoutSeconds: number(env, 'NOVA_HEARTBEAT_TIMEOUT_SECONDS', 30, 5),
    tickIntervalMs: number(env, 'NOVA_TICK_INTERVAL_MS', 1000, 50),
    queueUpdateIntervalMs: number(env, 'NOVA_QUEUE_UPDATE_INTERVAL_MS', 5000, 250),
    joinDelaySeconds: number(env, 'NOVA_JOIN_DELAY_SECONDS', 1),
    reservationTtlSeconds: number(env, 'NOVA_RESERVATION_TTL_SECONDS', 60, 5),
    sessionTtlMinutes: number(env, 'NOVA_SESSION_TTL_MINUTES', 60, 1),
    maxQueueSize: number(env, 'NOVA_MAX_QUEUE_SIZE', 10000, 1),
    defaultMaxPlayers,
    servers: parseServers(text(env, 'NOVA_SERVERS', ''), defaultRegion, defaultMaxPlayers),
    logLevel: (['debug', 'info', 'warn', 'error', 'silent'].includes(logLevel) ? logLevel : 'info') as LogLevel,
  };
}

export function ensureSecrets(config: NovaConfig, warn: (message: string) => void): NovaConfig {
  const next = { ...config };
  if (!next.ticketSecret) {
    next.ticketSecret = crypto.randomBytes(32).toString('base64url');
    warn('NOVA_TICKET_SECRET is not set. A random one was generated, so tickets signed before a restart stop working. Set it in .env.');
  }
  if (!next.apiKey) {
    warn('NOVA_API_KEY is not set. The server API is open to anyone who can reach Nova. Set it in .env.');
  }
  return next;
}
