import { Global, Module } from '@nestjs/common';
import { ChatModelFactory, LangfuseService } from './llm.providers.js';

/**
 * Global so every feature module can inject the model factory and Langfuse
 * without importing this module each time.
 */
@Global()
@Module({
  providers: [ChatModelFactory, LangfuseService],
  exports: [ChatModelFactory, LangfuseService],
})
export class LlmModule {}
