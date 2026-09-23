import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { env } from './shared/config/config.module';
import { GlobalExceptionFilter } from './shared/http/global-exception.filter';

// arch §5 steps 1–3, wired in order.
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. helmet + CORS (credentials, single client origin)
  app.use(helmet());
  app.enableCors({
    origin: env.CLIENT_URL,
    credentials: true,
  });

  // Task 2.14 — /auth/refresh and /auth/logout read the refreshToken/csrf
  // cookies server-side (arch §6.4), so req.cookies must be populated.
  app.use(cookieParser());

  // 3. global ValidationPipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  // Swagger — served at /docs. No version prefix: paths exactly as `/auth/login`.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('PracticePerfect API')
    .setDescription('PracticePerfect Epic-01 — User Management & Authentication')
    .setVersion('0.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(env.PORT);
}

void bootstrap();
