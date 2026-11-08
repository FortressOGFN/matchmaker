import crypto from 'crypto';
import { IncomingMessage } from 'http';
import { parseMatchmakingQuery } from '../core/bucket';
import { NovaConfig } from '../core/config';
import { epicSession } from '../core/epic';
import { signTicket, TicketRequest } from '../core/tickets';
import { Matchmaker } from '../queue/matchmaker';
import { SessionStore } from '../queue/sessions';
import { serverId, ServerRegistry } from '../servers/registry';
import { GameServer } from '../servers/types';
import { HttpError, RouteContext, Router } from './router';

export interface ApiDependencies {
  config: NovaConfig;
  registry: ServerRegistry;
  matchmaker: Matchmaker;
  sessions: SessionStore;
  version: string;
  startedAt: number;
  connections: () => number;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireKey(config: NovaConfig, request: IncomingMessage): void {
  if (!config.apiKey) return;
  const header = request.headers['x-api-key'];
  const bearer = /^bearer\s+(.+)$/i.exec(String(request.headers.authorization || ''))?.[1];
  const given = (Array.isArray(header) ? header[0] : header) || bearer || '';
  if (!given || !safeEqual(given, config.apiKey)) throw new HttpError(401, 'A valid API key is required', 'unauthorized');
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return value !== undefined && value !== null && value !== '' && Number.isFinite(parsed) ? parsed : undefined;
}

function resolveServer(registry: ServerRegistry, body: any, params: Record<string, string> = {}): GameServer {
  const id = params.id || string(body?.id);
  const server = id ? registry.find(id) : body?.ip && body?.port ? registry.findByAddress(String(body.ip), Number(body.port)) : undefined;
  if (!server) throw new HttpError(404, 'Game server not found. Register it first or send its id', 'server_not_found');
  return server;
}

function ticketRequest(config: NovaConfig, body: any): TicketRequest {
  const accountId = string(body?.accountId);
  if (!accountId) throw new HttpError(400, 'accountId is required', 'validation_failed');

  if (body?.query && typeof body.query === 'object') {
    const parsed = parseMatchmakingQuery(body.query, config.defaultRegion);
    if (!parsed) throw new HttpError(400, 'Could not read a playlist from the matchmaking query', 'validation_failed');
    const request: TicketRequest = {
      accountId,
      playlist: parsed.playlist,
      region: parsed.region,
      partyPlayerIds: parsed.partyPlayerIds,
      buildId: parsed.buildId,
    };
    if (parsed.customKey) request.customKey = parsed.customKey;
    if (parsed.platform) request.platform = parsed.platform;
    return request;
  }

  const playlist = string(body?.playlist);
  const customKey = string(body?.customKey);
  if (!playlist && !customKey) throw new HttpError(400, 'playlist or query is required', 'validation_failed');
  const request: TicketRequest = {
    accountId,
    playlist: playlist || '',
    region: string(body?.region) || config.defaultRegion,
    partyPlayerIds: Array.isArray(body?.partyPlayerIds) ? body.partyPlayerIds.filter((id: unknown) => typeof id === 'string') : [],
  };
  if (customKey) request.customKey = customKey;
  const buildId = string(body?.buildId);
  if (buildId) request.buildId = buildId;
  const platform = string(body?.platform);
  if (platform) request.platform = platform;
  return request;
}

export function createApi(deps: ApiDependencies): Router {
  const { config, registry, matchmaker, sessions } = deps;
  const router = new Router();
  const guarded = (handler: (context: RouteContext) => unknown) => (context: RouteContext) => {
    requireKey(config, context.request);
    return handler(context);
  };

  router.get('/health', () => ({ status: 'ok', version: deps.version, uptimeSeconds: Math.floor((Date.now() - deps.startedAt) / 1000) }));

  router.get('/api/v1/status', () => ({
    name: 'Nova',
    version: deps.version,
    uptimeSeconds: Math.floor((Date.now() - deps.startedAt) / 1000),
    connections: deps.connections(),
    ...matchmaker.stats(),
  }));

  router.post('/api/v1/tickets', guarded(({ body }) => {
    let signed;
    try {
      signed = signTicket(config.ticketSecret, ticketRequest(config, body), config.ticketTtlSeconds);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error), 'validation_failed');
    }
    return { serviceUrl: config.publicUrl, ...signed };
  }));

  router.get('/api/v1/queue', guarded(() => ({
    entries: matchmaker.queued().map((entry) => ({
      ticketId: entry.ticketId,
      accountId: entry.claims.accountId,
      playlist: entry.claims.playlist,
      region: entry.claims.region,
      customKey: entry.claims.customKey,
      partySize: entry.slots,
      waitingSeconds: Math.floor((Date.now() - entry.joinedAt) / 1000),
    })),
  })));

  router.get('/api/v1/servers', guarded(() => ({ servers: registry.all().map((server) => registry.toPublic(server)) })));

  router.post('/api/v1/servers', guarded(({ body }) => {
    try {
      const server = registry.register({
        ip: String(body?.ip || ''),
        port: Number(body?.port),
        playlist: string(body?.playlist),
        region: string(body?.region),
        maxPlayers: optionalNumber(body?.maxPlayers),
        playerCount: optionalNumber(body?.playerCount),
        customKey: typeof body?.customKey === 'string' ? body.customKey : undefined,
        ready: typeof body?.ready === 'boolean' ? body.ready : true,
      });
      return { success: true, server: registry.toPublic(server), heartbeatIntervalSeconds: Math.max(5, Math.floor(config.heartbeatTimeoutSeconds / 3)) };
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error), 'validation_failed');
    }
  }));

  router.post('/api/v1/servers/heartbeat', guarded(({ body }) => {
    let server = body?.id ? registry.find(String(body.id)) : registry.findByAddress(String(body?.ip || ''), Number(body?.port));
    if (!server && body?.ip && body?.port) {
      server = registry.register({ ip: String(body.ip), port: Number(body.port), playlist: string(body.playlist), region: string(body.region), maxPlayers: optionalNumber(body.maxPlayers), ready: body.ready !== false });
    }
    if (!server) throw new HttpError(404, 'Game server not found', 'server_not_found');
    registry.heartbeat(server.id, {
      playerCount: optionalNumber(body?.playerCount),
      ready: typeof body?.ready === 'boolean' ? body.ready : undefined,
      playlist: string(body?.playlist),
      maxPlayers: optionalNumber(body?.maxPlayers),
    });
    return { success: true, server: registry.toPublic(server) };
  }));

  router.post('/api/v1/servers/started', guarded(({ body }) => {
    const server = resolveServer(registry, body);
    registry.setClosed(server.id, true);
    return { success: true, server: registry.toPublic(server) };
  }));

  router.post('/api/v1/servers/open', guarded(({ body }) => {
    const server = resolveServer(registry, body);
    registry.setClosed(server.id, false);
    return { success: true, server: registry.toPublic(server) };
  }));

  router.get('/api/v1/servers/:id', guarded(({ params }) => registry.toPublic(resolveServer(registry, {}, params))));

  router.delete('/api/v1/servers/:id', guarded(({ params }) => {
    if (!registry.unregister(params.id)) throw new HttpError(404, 'Game server not found', 'server_not_found');
    return { success: true };
  }));

  router.post('/api/v1/servers/unregister', guarded(({ body }) => {
    const server = resolveServer(registry, body);
    registry.unregister(server.id);
    return { success: true };
  }));

  router.get('/api/v1/sessions/:sessionId', guarded(({ params }) => {
    const session = sessions.get(params.sessionId);
    if (!session) throw new HttpError(404, 'Session not found or expired', 'session_not_found');
    return session;
  }));

  router.get('/api/v1/sessions/:sessionId/epic', guarded(({ params, query }) => {
    const session = sessions.get(params.sessionId);
    if (!session) throw new HttpError(404, 'Session not found or expired', 'session_not_found');
    return epicSession(session, query.get('buildUniqueId') || undefined);
  }));

  router.get('/api/v1/accounts/:accountId/session', guarded(({ params }) => {
    const session = sessions.forAccount(params.accountId);
    if (!session) throw new HttpError(404, 'This account has no active session', 'session_not_found');
    return session;
  }));

  router.get('/api/v1/servers-by-address/:ip/:port', guarded(({ params }) => {
    const server = registry.find(serverId(params.ip, Number(params.port)));
    if (!server) throw new HttpError(404, 'Game server not found', 'server_not_found');
    return registry.toPublic(server);
  }));

  return router;
}
