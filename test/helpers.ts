import { loadConfig, NovaConfig } from '../src/core/config';
import { ClientSocket } from '../src/queue/matchmaker';
import { MmsMessage } from '../src/queue/protocol';
import { PortProbe } from '../src/servers/probe';

export function testConfig(overrides: Partial<NovaConfig> = {}, env: NodeJS.ProcessEnv = {}): NovaConfig {
  return {
    ...loadConfig({ NOVA_TICKET_SECRET: 'test-secret', NOVA_API_KEY: 'test-key', NOVA_LOG_LEVEL: 'silent', ...env }),
    readyDelaySeconds: 0,
    joinDelaySeconds: 0,
    ...overrides,
  };
}

export class FakeProbe implements PortProbe {
  readonly open = new Set<number>();
  async isPortInUse(port: number): Promise<boolean> {
    return this.open.has(port);
  }
}

export class FakeSocket implements ClientSocket {
  readonly messages: MmsMessage[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(message: MmsMessage): void {
    this.messages.push(message);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
  isOpen(): boolean {
    return this.closed === null;
  }
  states(): string[] {
    return this.messages.map((message) => (message.name === 'Play' ? 'Play' : String(message.payload.state)));
  }
}

export const LOCAL = new Set(['127.0.0.1']);

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
