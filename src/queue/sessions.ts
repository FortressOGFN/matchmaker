export interface MatchSession {
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

export class SessionStore {
  private readonly sessions = new Map<string, MatchSession>();
  private readonly byAccount = new Map<string, string>();

  constructor(private readonly ttlMs: number) {}

  add(session: MatchSession): void {
    this.sessions.set(session.sessionId.toLowerCase(), session);
    for (const accountId of session.accountIds) this.byAccount.set(accountId.toLowerCase(), session.sessionId.toLowerCase());
  }

  get(sessionId: string, now = Date.now()): MatchSession | undefined {
    const session = this.sessions.get(String(sessionId || '').toLowerCase());
    if (!session) return undefined;
    if (now - session.createdAt > this.ttlMs) {
      this.delete(session.sessionId);
      return undefined;
    }
    return session;
  }

  forAccount(accountId: string, now = Date.now()): MatchSession | undefined {
    const sessionId = this.byAccount.get(String(accountId || '').toLowerCase());
    return sessionId ? this.get(sessionId, now) : undefined;
  }

  delete(sessionId: string): void {
    const key = sessionId.toLowerCase();
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    for (const accountId of session.accountIds) {
      if (this.byAccount.get(accountId.toLowerCase()) === key) this.byAccount.delete(accountId.toLowerCase());
    }
  }

  prune(now = Date.now()): void {
    for (const session of [...this.sessions.values()]) {
      if (now - session.createdAt > this.ttlMs) this.delete(session.sessionId);
    }
  }

  size(): number {
    return this.sessions.size;
  }
}
