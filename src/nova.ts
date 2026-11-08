import http from 'http';
import { AddressInfo } from 'net';
import { ensureSecrets, NovaConfig } from './core/config';
import { createLogger, Logger } from './core/logger';
import { createApi } from './http/api';
import { Gateway } from './gateway/gateway';
import { Matchmaker } from './queue/matchmaker';
import { SessionStore } from './queue/sessions';
import { PortProbe, udpPortProbe } from './servers/probe';
import { ServerRegistry } from './servers/registry';

export const NOVA_VERSION = '1.0.0';

export interface NovaOptions {
  logger?: Logger;
  probe?: PortProbe;
  localAddresses?: Set<string>;
}

export class Nova {
  readonly config: NovaConfig;
  readonly logger: Logger;
  readonly registry: ServerRegistry;
  readonly sessions: SessionStore;
  readonly matchmaker: Matchmaker;
  readonly gateway: Gateway;
  private readonly http: http.Server;
  private readonly startedAt = Date.now();

  constructor(config: NovaConfig, options: NovaOptions = {}) {
    this.logger = options.logger || createLogger(config.logLevel);
    this.config = ensureSecrets(config, (message) => this.logger.warn('Config', message));
    this.registry = new ServerRegistry(this.config, this.logger, options.probe || udpPortProbe, options.localAddresses);
    this.sessions = new SessionStore(this.config.sessionTtlMinutes * 60 * 1000);
    this.matchmaker = new Matchmaker(this.config, this.registry, this.sessions, this.logger);
    this.gateway = new Gateway(this.config, this.matchmaker, this.logger);

    const api = createApi({
      config: this.config,
      registry: this.registry,
      matchmaker: this.matchmaker,
      sessions: this.sessions,
      version: NOVA_VERSION,
      startedAt: this.startedAt,
      connections: () => this.gateway.connections(),
    });

    this.http = http.createServer((request, response) => {
      void api.handle(request, response, (error) => this.logger.error('Http', `${request.method} ${request.url} failed`, error));
    });
    this.http.on('upgrade', (request, socket, head) => this.gateway.handleUpgrade(request, socket, head));
  }

  async start(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.config.port, this.config.host, () => {
        this.http.off('error', reject);
        resolve();
      });
    });

    this.registry.start();
    this.matchmaker.start();
    this.gateway.start();

    const port = this.port();
    this.logger.info('Nova', `Nova ${NOVA_VERSION} is listening on ${this.config.host}:${port}`);
    this.logger.info('Nova', `Clients connect to ${this.config.publicUrl}; ready check: ${this.config.readyCheck}; strict playlists: ${this.config.strictPlaylist}`);
    if (this.registry.all().length === 0) this.logger.info('Nova', 'No game servers configured yet. Add NOVA_SERVERS or register one through the API.');
    for (const server of this.registry.all()) this.logger.info('Nova', `Game server ${server.id} (${server.playlist}, ${server.region}, up to ${server.maxPlayers} players)`);
    return port;
  }

  port(): number {
    const address = this.http.address() as AddressInfo | null;
    return address ? address.port : this.config.port;
  }

  async stop(): Promise<void> {
    this.matchmaker.stop();
    this.gateway.stop();
    this.registry.stop();
    await new Promise<void>((resolve) => {
      this.http.closeAllConnections?.();
      this.http.close(() => resolve());
    });
    this.logger.info('Nova', 'Stopped');
  }
}
