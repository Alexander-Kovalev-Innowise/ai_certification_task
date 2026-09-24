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
  // Task 9.5 (Swagger/OpenAPI finalization): description/version updated to
  // reflect the full, completed Epic-01 backend surface (Phases 0-9) rather
  // than the Phase 0 scaffold placeholder — multi-role auth/RBAC, ShareLink
  // onboarding, multi-trainer player/parent contexts, coach availability,
  // Super Admin tools, impersonation, GDPR anonymization, portal branding,
  // and the transactional outbox — not just the auth slice the original
  // wording named. `1.0.0` marks this backend surface as complete and
  // stable for the frontend (Phase 10+) to build against; it is independent
  // of `package.json`'s own `0.0.0` (unpublished monorepo placeholder,
  // consistent across every workspace).
  const swaggerConfig = new DocumentBuilder()
    .setTitle('PracticePerfect API')
    .setDescription(
      'PracticePerfect Epic-01 backend — multi-role auth & RBAC, ShareLink onboarding, multi-trainer player/parent ' +
        'contexts, coach availability, Super Admin tools, impersonation, GDPR anonymization, and portal branding. ' +
        'See specs/architect-architecture.md and specs/api-designer-spec.md for the full design.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(env.PORT);
}

void bootstrap();
