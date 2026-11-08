import { NovaConfig } from '../core/config';
import { Logger } from '../core/logger';
import { normalizePlaylist, normalizeRegion } from '../core/playlists';
import { localAddresses, PortProbe } from './probe';
import { GameServer, HeartbeatInput, PublicServer, RegisterServerInput } from './types';

export function serverId(ip: string, port: number): string {
  return `${ip}:${port}`;
}

export class ServerRegistry {
  private readonly servers = new Map<string, GameServer>();
  private probeTimer: NodeJS.Timeout | null = null;
  private probing = false;

  constructor(
    private readonly config: NovaConfig,
    private readonly logger: Logger,
    private readonly probe: PortProbe,
    private readonly locals: Set<string> = localAddresses(),
  ) {
    for (const server of config.servers) {
      const created = this.create(server.ip, server.port, 'static');
      created.playlist = server.playlist;
      created.region = server.region;
      created.maxPlayers = server.maxPlayers;
    }
  }

  private create(ip: string, port: number, source: GameServer['source']): GameServer {
    const id = serverId(ip, port);
    const server: GameServer = {
      id,
      ip,
      port,
      playlist: 'playlist_defaultsolo',
      region: this.config.defaultRegion,
      maxPlayers: this.config.defaultMaxPlayers,
      playerCount: 0,
      source,
      readyCheck: this.config.readyCheck,
      local: this.locals.has(ip),
      reportedReady: false,
      lastHeartbeat: 0,
      portOpen: false,
      portOpenSince: 0,
      closed: false,
      createdAt: Date.now(),
      reservations: new Map(),
    };
    this.servers.set(id, server);
    return server;
  }

  find(idOrAddress: string): GameServer | undefined {
    return this.servers.get(idOrAddress);
  }

  findByAddress(ip: string, port: number): GameServer | undefined {
    return this.servers.get(serverId(ip, port));
  }

  all(): GameServer[] {
    return [...this.servers.values()];
  }

  register(input: RegisterServerInput, now = Date.now()): GameServer {
    const port = Number(input.port);
    if (!input.ip || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('ip and a port between 1 and 65535 are required');
    }
    const existing = this.findByAddress(input.ip, port);
    const server = existing || this.create(input.ip, port, 'registered');
    if (input.playlist) server.playlist = normalizePlaylist(input.playlist);
    if (input.region) server.region = normalizeRegion(input.region, this.config.defaultRegion);
    if (input.maxPlayers && input.maxPlayers > 0) server.maxPlayers = Math.floor(input.maxPlayers);
    if (typeof input.playerCount === 'number' && input.playerCount >= 0) server.playerCount = Math.floor(input.playerCount);
    if (input.customKey !== undefined) server.customKey = input.customKey ? String(input.customKey) : undefined;
    server.reportedReady = input.ready !== false;
    server.lastHeartbeat = now;
    if (!existing) this.logger.info('Servers', `Registered ${server.id} (${server.playlist}, ${server.region})`);
    return server;
  }

  heartbeat(id: string, input: HeartbeatInput, now = Date.now()): GameServer | undefined {
    const server = this.find(id);
    if (!server) return undefined;
    server.lastHeartbeat = now;
    if (typeof input.playerCount === 'number' && input.playerCount >= 0) {
      if (input.playerCount > server.playerCount) this.consumeReservations(server, input.playerCount - server.playerCount);
      server.playerCount = Math.floor(input.playerCount);
    }
    if (typeof input.ready === 'boolean') server.reportedReady = input.ready;
    if (input.playlist) server.playlist = normalizePlaylist(input.playlist);
    if (input.maxPlayers && input.maxPlayers > 0) server.maxPlayers = Math.floor(input.maxPlayers);
    return server;
  }

  setClosed(id: string, closed: boolean): GameServer | undefined {
    const server = this.find(id);
    if (!server) return undefined;
    if (server.closed !== closed) {
      server.closed = closed;
      if (closed) server.reservations.clear();
      this.logger.info('Servers', closed ? `${server.id} started its match and is closed to new players` : `${server.id} is open to new players`);
    }
    return server;
  }

  unregister(id: string): boolean {
    const server = this.find(id);
    if (!server) return false;
    if (server.source === 'static') {
      server.reportedReady = false;
      server.lastHeartbeat = 0;
      server.closed = false;
      server.reservations.clear();
      return true;
    }
    this.servers.delete(id);
    this.logger.info('Servers', `Unregistered ${id}`);
    return true;
  }

  private heartbeatFresh(server: GameServer, now: number): boolean {
    return server.lastHeartbeat > 0 && now - server.lastHeartbeat <= this.config.heartbeatTimeoutSeconds * 1000;
  }

  status(server: GameServer, now = Date.now()): { joinable: boolean; status: string } {
    if (server.closed) return { joinable: false, status: 'match in progress' };

    const reported = server.reportedReady && this.heartbeatFresh(server, now);
    if (server.source === 'registered') {
      return reported ? { joinable: true, status: 'ready' } : { joinable: false, status: 'waiting for heartbeat' };
    }

    switch (server.readyCheck) {
      case 'always':
        return { joinable: true, status: 'ready' };
      case 'register':
        return reported ? { joinable: true, status: 'ready' } : { joinable: false, status: 'waiting for registration' };
      default:
        if (reported) return { joinable: true, status: 'ready' };
        if (!server.local) return { joinable: false, status: 'waiting for registration' };
        if (!server.portOpen) return { joinable: false, status: 'offline' };
        if (now - server.portOpenSince < this.config.readyDelaySeconds * 1000) return { joinable: false, status: 'starting' };
        return { joinable: true, status: 'ready' };
    }
  }

  isJoinable(server: GameServer, now = Date.now()): boolean {
    return this.status(server, now).joinable;
  }

  reservedSlots(server: GameServer, now = Date.now()): number {
    let total = 0;
    for (const [key, reservation] of server.reservations) {
      if (reservation.expiresAt <= now) server.reservations.delete(key);
      else total += reservation.slots;
    }
    return total;
  }

  freeSlots(server: GameServer, now = Date.now()): number {
    return Math.max(0, server.maxPlayers - server.playerCount - this.reservedSlots(server, now));
  }

  reserve(server: GameServer, sessionId: string, slots: number, now = Date.now()): void {
    server.reservations.set(sessionId, { slots, expiresAt: now + this.config.reservationTtlSeconds * 1000 });
  }

  private consumeReservations(server: GameServer, joined: number): void {
    let remaining = joined;
    const ordered = [...server.reservations.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (const [key, reservation] of ordered) {
      if (remaining <= 0) break;
      const used = Math.min(remaining, reservation.slots);
      reservation.slots -= used;
      remaining -= used;
      if (reservation.slots <= 0) server.reservations.delete(key);
    }
  }

  prune(now = Date.now()): void {
    for (const server of this.all()) {
      if (server.source === 'registered' && !this.heartbeatFresh(server, now)) {
        this.servers.delete(server.id);
        this.logger.warn('Servers', `${server.id} stopped sending heartbeats and was removed`);
      }
    }
  }

  async probeOnce(now = Date.now()): Promise<void> {
    if (this.probing) return;
    this.probing = true;
    try {
      for (const server of this.all()) {
        if (server.source !== 'static' || server.readyCheck !== 'probe' || !server.local) continue;
        const open = await this.probe.isPortInUse(server.port);
        if (open && !server.portOpen) {
          server.portOpen = true;
          server.portOpenSince = now;
          this.logger.info('Servers', `${server.id} is up (${server.playlist}); joinable in ${this.config.readyDelaySeconds}s`);
        } else if (!open && server.portOpen) {
          server.portOpen = false;
          server.portOpenSince = 0;
          server.closed = false;
          server.playerCount = 0;
          server.reservations.clear();
          this.logger.info('Servers', `${server.id} went offline`);
        }
      }
    } finally {
      this.probing = false;
    }
  }

  start(): void {
    for (const server of this.all()) {
      if (server.source === 'static' && server.readyCheck === 'probe' && !server.local) {
        this.logger.warn('Servers', `${server.id} is not on this machine, so it is only joinable after it registers or sends heartbeats`);
      }
    }
    if (this.config.readyCheck === 'probe' && this.all().some((server) => server.local)) {
      void this.probeOnce();
      this.probeTimer = setInterval(() => void this.probeOnce(), this.config.probeIntervalMs);
      this.probeTimer.unref?.();
    }
  }

  stop(): void {
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.probeTimer = null;
  }

  toPublic(server: GameServer, now = Date.now()): PublicServer {
    const state = this.status(server, now);
    const result: PublicServer = {
      id: server.id,
      address: server.id,
      playlist: server.playlist,
      region: server.region,
      source: server.source,
      joinable: state.joinable,
      status: state.status,
      playerCount: server.playerCount,
      reservedSlots: this.reservedSlots(server, now),
      maxPlayers: server.maxPlayers,
    };
    if (server.customKey) result.customKey = server.customKey;
    return result;
  }
}
