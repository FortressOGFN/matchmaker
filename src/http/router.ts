import { IncomingMessage, ServerResponse } from 'http';

export interface RouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
}

export type Handler = (context: RouteContext) => unknown | Promise<unknown>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = 'error') {
    super(message);
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  response.end(text);
}

function readBody(request: IncomingMessage, limit: number): Promise<any> {
  return new Promise((resolve, reject) => {
    if (request.method === 'GET' || request.method === 'HEAD') return resolve(undefined);
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request body is too large', 'body_too_large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (chunks.length === 0) return resolve({});
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, 'Request body must be JSON', 'invalid_json'));
      }
    });
    request.on('error', reject);
  });
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler): this {
    const keys: string[] = [];
    const source = path
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          keys.push(segment.slice(1));
          return '([^/]+)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.routes.push({ method: method.toUpperCase(), pattern: new RegExp(`^${source}/?$`), keys, handler });
    return this;
  }

  get(path: string, handler: Handler): this {
    return this.add('GET', path, handler);
  }

  post(path: string, handler: Handler): this {
    return this.add('POST', path, handler);
  }

  delete(path: string, handler: Handler): this {
    return this.add('DELETE', path, handler);
  }

  async handle(request: IncomingMessage, response: ServerResponse, onError: (error: unknown) => void): Promise<void> {
    const url = new URL(request.url || '/', 'http://nova');
    const method = (request.method || 'GET').toUpperCase();
    let pathMatched = false;

    for (const route of this.routes) {
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      pathMatched = true;
      if (route.method !== method) continue;

      try {
        const params: Record<string, string> = {};
        route.keys.forEach((key, index) => (params[key] = decodeURIComponent(match[index + 1])));
        const body = await readBody(request, 64 * 1024);
        const result = await route.handler({ request, response, params, query: url.searchParams, body });
        if (!response.headersSent) sendJson(response, 200, result ?? { success: true });
      } catch (error) {
        if (error instanceof HttpError) {
          sendJson(response, error.status, { error: error.code, message: error.message });
        } else {
          onError(error);
          sendJson(response, 500, { error: 'internal_error', message: 'Something went wrong inside Nova' });
        }
      }
      return;
    }

    if (pathMatched) sendJson(response, 405, { error: 'method_not_allowed', message: `${method} is not allowed on ${url.pathname}` });
    else sendJson(response, 404, { error: 'not_found', message: `No route for ${method} ${url.pathname}` });
  }
}
