import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { RequestMeta } from '../identity/identity.service.js';
import type { OgsRequest } from './access.types.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,100}$/;

/**
 * Request id (accepted from X-Request-Id when well-formed, else generated),
 * client IP (Express `req.ip`, which honours TRUST_PROXY_HOPS) and user agent.
 */
export function requestMeta(request: OgsRequest): RequestMeta {
  if (request.requestId === undefined) {
    const header = request.headers['x-request-id'];
    request.requestId =
      typeof header === 'string' && REQUEST_ID_PATTERN.test(header) ? header : randomUUID();
  }
  const ip = request.ip ?? null;
  const userAgent = request.headers['user-agent'];
  return {
    requestId: request.requestId,
    ip: ip !== null && isIP(ip) !== 0 ? ip : null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : null,
  };
}
