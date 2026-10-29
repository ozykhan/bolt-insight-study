import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { DISTINCT_ID_HEADER } from '@probe-lab/shared';

/**
 * Injects the browser's PostHog distinct id from the request header, or null
 * when there is none. A custom parameter decorator keeps header parsing out of
 * the handlers: `generate(@DistinctId() distinctId: string | null)`.
 */
export const DistinctId = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const value = context.switchToHttp().getRequest<Request>().header(DISTINCT_ID_HEADER);
  return value && value.length <= 200 ? value : null;
});
