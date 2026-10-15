import { Global, Module } from '@nestjs/common';

import { DomainEventsEmitter } from './domain-events.emitter';

// Task 3.7. @Global() per the same "cross-cutting infra, needed wherever a
// domain event might be emitted or (eventually) subscribed to" reasoning as
// PrismaModule/ConfigModule/SecurityModule (arch "Global Conventions").
@Global()
@Module({
  providers: [DomainEventsEmitter],
  exports: [DomainEventsEmitter],
})
export class EventsModule {}
