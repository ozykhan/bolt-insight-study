import type { IncomingHttpHeaders } from 'node:http';
import { normalizeIp } from '@nestjs/throttler';

/**
 * The client's IP, for rate limits. Behind a host's edge proxy the socket's
 * remote address is the proxy, so the client's IP comes from a header the
 * proxy sets (Railway sets x-real-ip and overwrites whatever the client sent).
 * Only trust a header that the proxy always writes: a client can put any
 * value in a header the proxy passes through untouched.
 *
 * IPv6 addresses are cut to their /64 network, as @nestjs/throttler does,
 * since one machine usually holds a whole /64.
 */
export function clientIp(
  headers: IncomingHttpHeaders,
  remoteAddress: string | undefined,
  trustedHeader: string | undefined,
): string {
  const value = trustedHeader ? headers[trustedHeader.toLowerCase()] : undefined;
  const fromProxy = (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim();
  return normalizeIp(fromProxy || remoteAddress || 'unknown');
}
