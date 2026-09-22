import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

// Placeholder bootstrap — full pipeline wiring (helmet, CORS, ValidationPipe,
// GlobalExceptionFilter, Swagger) happens in Task 0.11.
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
