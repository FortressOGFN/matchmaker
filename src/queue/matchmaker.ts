import { NovaConfig } from '../core/config';
import { newId } from '../core/ids';
import { Logger } from '../core/logger';
import { samePlaylist } from '../core/playlists';
import { TicketClaims } from '../core/tickets';
import { ServerRegistry } from '../servers/registry';
import { GameServer } from '../servers/types';
import { Messages, MmsMessage } from './protocol';
import { MatchSession, SessionStore } from './sessions';

export interface ClientSocket {
  send(message: MmsMessage): void;
  close(code?: number, reason?: string): void;
  isOpen(): boolean;
}

export type EntryState = 'queued' | 'assigned' | 'removed';

export interface QueueEntry {
  ticketId: string;
  matchId: string;
  sessionId: string;
  claims: TicketClaims;
  slots: number;
  joinedAt: number;
  state: EntryState;
  socket: ClientSocket;
  lastNoServerLog: number;
}

export interface PlaylistStats {
  playlist: string;
  queued: number;
  joinableServers: number;
}

export interface MatchmakerStats {
  queuedTickets: number;
  queuedPlayers: number;
  servers: number;
  joinableServers: number;
  sessions: number;
  playlists: PlaylistStats[];
}

export class Matchmaker {
  private readonly queue: QueueEntry[] = [];
  private readonly byAccount = new Map<string, QueueEntry>();
  private tickTimer: NodeJS.Timeout | null = null;
  private updateTimer: NodeJS.Timeout | null = null;
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly recentWaits: number[] = [];

  constructor(
    private readonly config: NovaConfig,
    private readonly registry: ServerRegistry,
    private readonly sessions: SessionStore,
    private readonly logger: Logger,
  ) {}

  enqueue(claims: TicketClaims, socket: ClientSocket, now = Date.now()): QueueEntry | null {
    if (this.queue.length >= this.config.maxQueueSize) {
      socket.close(4003, 'Matchmaking queue is full');
      return null;
    }

    const accountKey = claims.accountId.toLowerCase();
    const previous = this.byAccount.get(accountKey);
    if (previous) {
      this.remove(previous);
      previous.socket.close(4000, 'Replaced by a newer matchmaking request');
    }

    const entry: QueueEntry = {
      ticketId: newId(),
      matchId: newId(),
      sessionId: newId(),
      claims,
      slots: Math.max(1, claims.partyPlayerIds.length),
      joinedAt: now,
      state: 'queued',
      socket,
      lastNoServerLog: 0,
    };
    this.queue.push(entry);
    this.byAccount.set(accountKey, entry);

    const target = claims.customKey ? `custom key ${claims.customKey}` : claims.playlist;
    this.logger.info('Queue', `${claims.accountId} joined the queue for ${target} (${claims.region}, party of ${entry.slots})`);
    this.sendQueued(entry);
    return entry;
  }

  remove(entry: QueueEntry): void {
    if (entry.state === 'removed') return;
    const wasQueued = entry.state === 'queued';
    entry.state = 'removed';
    const index = this.queue.indexOf(entry);
    if (index >= 0) this.queue.splice(index, 1);
    const key = entry.claims.accountId.toLowerCase();
    if (this.byAccount.get(key) === entry) this.byAccount.delete(key);
    if (wasQueued) this.logger.debug('Queue', `${entry.claims.accountId} left the queue`);
  }

  private position(entry: QueueEntry): number {
    let position = 0;
    for (const other of this.queue) {
      if (other.state !== 'queued') continue;
      if (this.sameTarget(other, entry)) position += other.slots;
      if (other === entry) break;
    }
    return position;
  }

  private sameTarget(a: QueueEntry, b: QueueEntry): boolean {
    if (a.claims.customKey || b.claims.customKey) return a.claims.customKey === b.claims.customKey;
    return samePlaylist(a.claims.playlist, b.claims.playlist);
  }

  private estimatedWait(): number {
    if (this.recentWaits.length === 0) return -1;
    const average = this.recentWaits.reduce((sum, value) => sum + value, 0) / this.recentWaits.length;
    return Math.max(1, Math.round(average));
  }

  private sendQueued(entry: QueueEntry): void {
    if (entry.state !== 'queued' || !entry.socket.isOpen()) return;
    entry.socket.send(Messages.queued(entry.ticketId, this.position(entry), this.estimatedWait()));
  }

  private candidates(entry: QueueEntry, now: number): GameServer[] {
    const joinable = this.registry.all().filter((server) => this.registry.isJoinable(server, now) && this.registry.freeSlots(server, now) >= entry.slots);

    if (entry.claims.customKey) {
      return joinable.filter((server) => server.customKey === entry.claims.customKey);
    }

    const open = joinable.filter((server) => !server.customKey);
    const matching = open.filter((server) => samePlaylist(server.playlist, entry.claims.playlist));
    if (matching.length > 0 || this.config.strictPlaylist) return matching;
    return open;
  }

  private choose(entry: QueueEntry, now: number): GameServer | undefined {
    const region = entry.claims.region;
    return this.candidates(entry, now).sort((a, b) => {
      const regionA = a.region === region ? 1 : 0;
      const regionB = b.region === region ? 1 : 0;
      if (regionA !== regionB) return regionB - regionA;
      const fillA = a.playerCount + this.registry.reservedSlots(a, now);
      const fillB = b.playerCount + this.registry.reservedSlots(b, now);
      return fillB - fillA;
    })[0];
  }

  private assign(entry: QueueEntry, server: GameServer, now: number): void {
    entry.state = 'assigned';
    const index = this.queue.indexOf(entry);
    if (index >= 0) this.queue.splice(index, 1);

    this.registry.reserve(server, entry.sessionId, entry.slots, now);

    const session: MatchSession = {
      sessionId: entry.sessionId,
      matchId: entry.matchId,
      serverId: server.id,
      ip: server.ip,
      port: server.port,
      playlist: server.playlist,
      region: server.region,
      accountIds: entry.claims.partyPlayerIds,
      createdAt: now,
    };
    if (entry.claims.buildId) session.buildId = entry.claims.buildId;
    this.sessions.add(session);

    const waited = (now - entry.joinedAt) / 1000;
    this.recentWaits.push(waited);
    if (this.recentWaits.length > 50) this.recentWaits.shift();

    this.logger.info('Queue', `${entry.claims.accountId} → ${server.id} (${server.playlist}) after ${waited.toFixed(1)}s, session ${entry.sessionId}`);
    entry.socket.send(Messages.sessionAssignment(entry.matchId));

    const play = setTimeout(() => {
      this.timers.delete(play);
      if (entry.socket.isOpen()) entry.socket.send(Messages.play(entry.matchId, entry.sessionId, this.config.joinDelaySeconds));
      const close = setTimeout(() => {
        this.timers.delete(close);
        if (entry.socket.isOpen()) entry.socket.close(1000, 'Match found');
        const key = entry.claims.accountId.toLowerCase();
        if (this.byAccount.get(key) === entry) this.byAccount.delete(key);
      }, 30000);
      close.unref?.();
      this.timers.add(close);
    }, Math.max(0, this.config.joinDelaySeconds * 1000));
    play.unref?.();
    this.timers.add(play);
  }

  tick(now = Date.now()): number {
    this.registry.prune(now);
    this.sessions.prune(now);

    let assigned = 0;
    for (const entry of [...this.queue]) {
      if (entry.state !== 'queued') continue;
      if (!entry.socket.isOpen()) {
        this.remove(entry);
        continue;
      }

      const server = this.choose(entry, now);
      if (server) {
        this.assign(entry, server, now);
        assigned++;
      } else if (now - entry.lastNoServerLog > 30000) {
        entry.lastNoServerLog = now;
        const target = entry.claims.customKey ? `custom key ${entry.claims.customKey}` : entry.claims.playlist;
        this.logger.info('Queue', `No joinable server for ${target} yet; ${entry.claims.accountId} keeps waiting`);
      }
    }
    return assigned;
  }

  broadcastQueue(): void {
    for (const entry of this.queue) this.sendQueued(entry);
  }

  queued(): QueueEntry[] {
    return this.queue.filter((entry) => entry.state === 'queued');
  }

  stats(now = Date.now()): MatchmakerStats {
    const queued = this.queued();
    const servers = this.registry.all();
    const playlists = new Map<string, PlaylistStats>();

    for (const server of servers) {
      const stats = playlists.get(server.playlist) || { playlist: server.playlist, queued: 0, joinableServers: 0 };
      if (this.registry.isJoinable(server, now)) stats.joinableServers++;
      playlists.set(server.playlist, stats);
    }
    for (const entry of queued) {
      if (!entry.claims.playlist) continue;
      const stats = playlists.get(entry.claims.playlist) || { playlist: entry.claims.playlist, queued: 0, joinableServers: 0 };
      stats.queued += entry.slots;
      playlists.set(entry.claims.playlist, stats);
    }

    return {
      queuedTickets: queued.length,
      queuedPlayers: queued.reduce((sum, entry) => sum + entry.slots, 0),
      servers: servers.length,
      joinableServers: servers.filter((server) => this.registry.isJoinable(server, now)).length,
      sessions: this.sessions.size(),
      playlists: [...playlists.values()].sort((a, b) => a.playlist.localeCompare(b.playlist)),
    };
  }

  start(): void {
    this.tickTimer = setInterval(() => {
      try {
        this.tick();
      } catch (error) {
        this.logger.error('Queue', 'Matchmaking tick failed', error);
      }
    }, this.config.tickIntervalMs);
    this.updateTimer = setInterval(() => this.broadcastQueue(), this.config.queueUpdateIntervalMs);
    this.tickTimer.unref?.();
    this.updateTimer.unref?.();
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.updateTimer) clearInterval(this.updateTimer);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.tickTimer = null;
    this.updateTimer = null;
    for (const entry of [...this.queue]) {
      this.remove(entry);
      if (entry.socket.isOpen()) entry.socket.close(1001, 'Nova is shutting down');
    }
  }
}
