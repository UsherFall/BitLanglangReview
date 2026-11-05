import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';

export type CapturedRouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export function captureRoutes(register: (server: ViteDevServer) => void) {
  const handlers = new Map<string, CapturedRouteHandler>();
  const order: string[] = [];
  const server = {
    middlewares: {
      use(route: string, handler: CapturedRouteHandler) {
        order.push(route);
        handlers.set(route, handler);
      },
    },
  };
  register(server as unknown as ViteDevServer);
  return { handlers, order };
}

export async function invokeRoute(
  handler: CapturedRouteHandler,
  input: { method?: string; url?: string; body?: unknown } = {},
): Promise<{ status: number; headers: Record<string, string>; json: any; text: string }> {
  const rawBody = input.body === undefined ? '' : JSON.stringify(input.body);
  const req = Readable.from(rawBody ? [rawBody] : []) as IncomingMessage;
  req.method = input.method ?? 'GET';
  req.url = input.url ?? '/';
  const headers: Record<string, string> = {};
  let text = '';
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(body: string) {
      text = body;
    },
  } as ServerResponse;
  await handler(req, res);
  return {
    status: res.statusCode,
    headers,
    text,
    json: text ? JSON.parse(text) : undefined,
  };
}
