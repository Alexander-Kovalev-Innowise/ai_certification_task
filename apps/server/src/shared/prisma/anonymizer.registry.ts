import { Injectable } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';

import { Anonymizer, isAnonymizer } from './anonymizer.interface';

// Task 3.4 (arch §11.2). Discovers every registered Anonymizer via Nest's
// own DiscoveryService — the same app-wide discovery mechanism
// assertRoutesHaveRequiredCapability (Task 2.8) already uses for
// controllers — rather than a literal Angular-style multi-provider token.
// NestJS's `@Module({ providers: [...] })` does not merge multiple
// ClassProviders registered under the same DI token into an array (and a
// literal `{ provide, useClass, multi: true }` object isn't a valid
// `Provider` shape — it wouldn't compile); the architecture doc's
// `multi: true` snippet is shorthand for "every PII-holding module
// registers one," not literal working Nest DI. Any provider instance
// shaped like an Anonymizer (readonly `model: string` +
// `anonymize(userId, tx)`) is picked up automatically here regardless of
// which module declares it, so a later phase's anonymizer (player-profiles,
// coaches) needs no central wiring change — just `@Injectable()` + being
// listed in its own module's `providers`.
@Injectable()
export class AnonymizerRegistry {
  constructor(private readonly discoveryService: DiscoveryService) {}

  findAll(): Anonymizer[] {
    return this.discoveryService
      .getProviders()
      .map((wrapper) => wrapper.instance as unknown)
      .filter(isAnonymizer);
  }
}
