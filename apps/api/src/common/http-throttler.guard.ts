import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * ThrottlerGuard for HTTP routes only. The interview gateway checks its own
 * limits and answers with an Ack the chat can show; a guard there would throw
 * instead, and a Nest gateway exception never reaches the client's ack.
 */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return context.getType() !== 'http';
  }
}
