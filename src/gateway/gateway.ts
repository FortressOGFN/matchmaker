import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import WebSocket, { WebSocketServer } from 'ws';
import { NovaConfig } from '../core/config';
import { Logger } from '../core/logger';
import { normalizePlaylist, normalizeRegion } from '../core/playlists';
import { parseAuthorization, TICKET_TYPE, TicketClaims, verifyTicket } from '../core/tickets';
import { ClientSocket, Matchmaker } from '../queue/matchmaker';
import { Messages, MmsMessage } from '../queue/protocol';

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(reason)}\r\n\r\n${reason}`);
  socket.destroy();
}

function wrap(socket: WebSocket): ClientSocket {
  return {
    send(message: MmsMessage) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    close(code?: number, reason?: string) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(code, reason);
    },
    isOpen() {
      return socket.readyState === WebSocket.OPEN;
    },
  };
}

export class Gateway {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly alive = new WeakMap<WebSocket, boolean>();

  constructor(
    private readonly config: NovaConfig,
    private readonly matchmaker: Matchmaker,
    private readonly logger: Logger,
  ) {}

  authenticate(request: IncomingMessage, now = Date.now()): { ok: true; claims: TicketClaims } | { ok: false; reason: string } {
    const authorization = parseAuthorization(request.headers.authorization);
    if (authorization) {
      if (authorization.ticketType !== TICKET_TYPE) return { ok: false, reason: `unsupported ticket type ${authorization.ticketType}` };
      return verifyTicket(this.config.ticketSecret, authorization.payload, authorization.signature, now);
    }

    if (!this.config.allowUnsignedTickets) return { ok: false, reason: 'missing Epic-Signed authorization header' };

    const url = new URL(request.url || '/', 'ws://nova');
    const accountId = url.searchParams.get('accountId') || `guest-${Math.random().toString(36).slice(2, 10)}`;
    const playlist = normalizePlaylist(url.searchParams.get('playlist') || 'playlist_defaultsolo');
    const party = (url.searchParams.get('partyPlayerIds') || '').split(',').map((id) => id.trim()).filter(Boolean);
    const claims: TicketClaims = {
      accountId,
      playlist,
      region: normalizeRegion(url.searchParams.get('region'), this.config.defaultRegion),
      partyPlayerIds: [...new Set([accountId, ...party])],
      issuedAt: now,
      expiresAt: now + this.config.ticketTtlSeconds * 1000,
      nonce: 'unsigned',
    };
    const customKey = url.searchParams.get('customKey');
    if (customKey) claims.customKey = customKey;
    return { ok: true, claims };
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const result = this.authenticate(request);
    if (!result.ok) {
      this.logger.warn('Gateway', `Rejected a matchmaking connection from ${request.socket.remoteAddress}: ${result.reason}`);
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }

    this.server.handleUpgrade(request, socket, head, (ws) => this.accept(ws, result.claims));
  }

  private accept(ws: WebSocket, claims: TicketClaims): void {
    this.alive.set(ws, true);
    ws.on('pong', () => this.alive.set(ws, true));

    const client = wrap(ws);
    let entry: ReturnType<Matchmaker['enqueue']> = null;
    let closed = false;
    const steps: NodeJS.Timeout[] = [];

    ws.on('close', () => {
      closed = true;
      for (const step of steps) clearTimeout(step);
      if (entry && entry.state === 'queued') {
        this.matchmaker.remove(entry);
        this.logger.info('Gateway', `${claims.accountId} cancelled matchmaking`);
      }
    });
    ws.on('error', (error) => this.logger.debug('Gateway', `Socket error for ${claims.accountId}: ${error.message}`));
    ws.on('message', () => undefined);

    client.send(Messages.connecting());
    steps.push(setTimeout(() => {
      if (closed) return;
      client.send(Messages.waiting(claims.partyPlayerIds.length));
      steps.push(setTimeout(() => {
        if (closed) return;
        entry = this.matchmaker.enqueue(claims, client);
      }, 200));
    }, 200));
  }

  start(): void {
    this.heartbeat = setInterval(() => {
      for (const ws of this.server.clients) {
        if (this.alive.get(ws) === false) {
          ws.terminate();
          continue;
        }
        this.alive.set(ws, false);
        try {
          ws.ping();
        } catch {}
      }
    }, 30000);
    this.heartbeat.unref?.();
  }

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const ws of this.server.clients) ws.terminate();
    this.server.close();
  }

  connections(): number {
    return this.server.clients.size;
  }
}
