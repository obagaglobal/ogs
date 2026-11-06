import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '@/App';

export interface MockRoute {
  readonly status: number;
  readonly body?: unknown;
}

export type MockApi = Record<string, MockRoute | ((init: RequestInit) => MockRoute)>;

export interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/**
 * Mocks fetch with a table of `"METHOD /path"` → response, and records every
 * call (method, path, headers, parsed body) for assertions.
 */
export function mockApi(routes: MockApi): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init = {}) => {
    const url = new URL(
      typeof input === 'string' ? input : (input as Request).url,
      'http://localhost',
    );
    const method = init.method ?? 'GET';
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    calls.push({
      method,
      path,
      headers,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    const route = routes[`${method} ${path}`];
    const resolved = typeof route === 'function' ? route(init) : route;
    const { status, body } = resolved ?? { status: 404, body: { error: 'not_found' } };
    return Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  return calls;
}

export function renderApp(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export const signedIn = (overrides: { mfaPending?: boolean; status?: string } = {}) => ({
  status: 200,
  body: {
    user: {
      id: '01930000-0000-7000-8000-000000000102',
      email: 'alice@acme.test',
      status: overrides.status ?? 'ACTIVE',
      mfaEnabled: true,
    },
    session: {
      id: '01930000-0000-7000-8000-000000000999',
      createdAt: '2026-11-06T08:00:00.000Z',
      lastSeenAt: '2026-11-06T08:00:00.000Z',
      expiresAt: '2026-11-06T20:00:00.000Z',
      ip: '127.0.0.1',
      userAgent: 'test',
      current: true,
      mfaPending: overrides.mfaPending ?? false,
    },
  },
});
