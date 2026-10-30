import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Nest's Socket.io adapter with CORS from config. `@WebSocketGateway()`
 * options are fixed when the class is decorated, before ConfigService exists,
 * so server options that come from the environment belong in an adapter.
 * CORS here covers Socket.io's HTTP long-polling transport; browsers do not
 * apply CORS to the WebSocket upgrade.
 */
export class CorsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    return super.createIOServer(port, { ...options, cors: { origin: this.origins } } as ServerOptions);
  }
}
