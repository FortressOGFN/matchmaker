export interface NovaClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface EpicTicketResponse {
  serviceUrl: string;
  ticketType: string;
  payload: string;
  signature: string;
}

export interface NovaSession {
  sessionId: string;
  matchId: string;
  serverId: string;
  ip: string;
  port: number;
  playlist: string;
  region: string;
  buildId?: string;
  accountIds: string[];
  createdAt: number;
}

export interface RegisterOptions {
  ip: string;
  port: number;
  playlist?: string;
  region?: string;
  maxPlayers?: number;
  playerCount?: number;
  customKey?: string;
  ready?: boolean;
}

export class NovaError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export class NovaClient {
  private readonly baseUrl: string;

  constructor(private readonly options: NovaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 5000);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (this.options.apiKey) headers['X-Api-Key'] = this.options.apiKey;
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) throw new NovaError(response.status, data.error || 'error', data.message || `Nova responded with ${response.status}`);
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  createTicket(accountId: string, query: Record<string, unknown>): Promise<EpicTicketResponse> {
    return this.request('POST', '/api/v1/tickets', { accountId, query });
  }

  createTicketFor(request: { accountId: string; playlist: string; region?: string; partyPlayerIds?: string[]; customKey?: string; buildId?: string }): Promise<EpicTicketResponse> {
    return this.request('POST', '/api/v1/tickets', request);
  }

  getSession(sessionId: string): Promise<NovaSession> {
    return this.request('GET', `/api/v1/sessions/${encodeURIComponent(sessionId)}`);
  }

  getEpicSession(sessionId: string, buildUniqueId?: string): Promise<Record<string, unknown>> {
    const suffix = buildUniqueId ? `?buildUniqueId=${encodeURIComponent(buildUniqueId)}` : '';
    return this.request('GET', `/api/v1/sessions/${encodeURIComponent(sessionId)}/epic${suffix}`);
  }

  getAccountSession(accountId: string): Promise<NovaSession> {
    return this.request('GET', `/api/v1/accounts/${encodeURIComponent(accountId)}/session`);
  }

  registerServer(options: RegisterOptions): Promise<{ success: boolean; heartbeatIntervalSeconds: number }> {
    return this.request('POST', '/api/v1/servers', options);
  }

  heartbeat(ip: string, port: number, update: { playerCount?: number; ready?: boolean } = {}): Promise<unknown> {
    return this.request('POST', '/api/v1/servers/heartbeat', { ip, port, ...update });
  }

  markStarted(ip: string, port: number): Promise<unknown> {
    return this.request('POST', '/api/v1/servers/started', { ip, port });
  }

  markOpen(ip: string, port: number): Promise<unknown> {
    return this.request('POST', '/api/v1/servers/open', { ip, port });
  }

  unregister(ip: string, port: number): Promise<unknown> {
    return this.request('POST', '/api/v1/servers/unregister', { ip, port });
  }

  status(): Promise<Record<string, unknown>> {
    return this.request('GET', '/api/v1/status');
  }
}
