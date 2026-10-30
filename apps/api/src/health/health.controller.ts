import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { SkipThrottle } from '@nestjs/throttler';
import type { Connection } from 'mongoose';

/**
 * Railway calls this after each deploy and only moves traffic to the new
 * version once it answers 200, so a build that cannot reach MongoDB never
 * replaces one that can.
 */
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  check(): { status: 'ok' } {
    // Mongoose's readyState 1 is "connected".
    if (this.connection.readyState !== 1) {
      throw new ServiceUnavailableException('MongoDB is not connected');
    }
    return { status: 'ok' };
  }
}
