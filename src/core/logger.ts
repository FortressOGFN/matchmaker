export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const COLORS: Record<Exclude<LogLevel, 'silent'>, string> = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };

export interface Logger {
  debug(scope: string, message: string): void;
  info(scope: string, message: string): void;
  warn(scope: string, message: string): void;
  error(scope: string, message: string, error?: unknown): void;
}

export function createLogger(level: LogLevel = 'info', useColor = process.stdout.isTTY === true): Logger {
  const threshold = ORDER[level] ?? ORDER.info;

  const write = (entryLevel: Exclude<LogLevel, 'silent'>, scope: string, message: string) => {
    if (ORDER[entryLevel] < threshold) return;
    const time = new Date().toISOString();
    const label = entryLevel.toUpperCase().padEnd(5);
    const line = useColor
      ? `\x1b[90m${time}\x1b[0m ${COLORS[entryLevel]}${label}\x1b[0m \x1b[35m[Nova:${scope}]\x1b[0m ${message}`
      : `${time} ${label} [Nova:${scope}] ${message}`;
    if (entryLevel === 'error') console.error(line);
    else if (entryLevel === 'warn') console.warn(line);
    else console.log(line);
  };

  return {
    debug: (scope, message) => write('debug', scope, message),
    info: (scope, message) => write('info', scope, message),
    warn: (scope, message) => write('warn', scope, message),
    error: (scope, message, error) => {
      const detail = error instanceof Error ? `: ${error.stack || error.message}` : error !== undefined ? `: ${String(error)}` : '';
      write('error', scope, `${message}${detail}`);
    },
  };
}

export const silentLogger: Logger = createLogger('silent', false);
