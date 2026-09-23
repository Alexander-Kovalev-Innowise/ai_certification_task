import { PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { REQUIRES_CAPABILITY_KEY } from './decorators/requires-capability.decorator';

// Task 2.8 (arch §9.2/§20 DoD boot-time assertion). Extracted out of
// AppModule.onModuleInit into its own function — not one of the task's
// literal two files, but needed so app-module-boot.e2e-spec.ts can drive it
// against its own deliberately-broken throwaway controller/TestingModule
// (per the plan's own note that spec's test module is "temporary/local to
// the spec file, not shipped code") without needing to mutate the real,
// statically-defined AppModule class at test time.
//
// Walks every controller method that carries Nest's own route-path metadata
// (PATH_METADATA — set by @Get/@Post/etc, not present on plain helper
// methods) and throws if it is neither @Public() nor annotated with
// @RequiresCapability(...). This is what turns "every new controller method
// must carry @RequiresCapability" from a convention into a startup failure.
export function assertRoutesHaveRequiredCapability(
  discoveryService: DiscoveryService,
  metadataScanner: MetadataScanner,
  reflector: Reflector,
): void {
  const controllers = discoveryService.getControllers();

  for (const wrapper of controllers) {
    const { instance } = wrapper;
    if (!instance) {
      continue;
    }

    const prototype = Object.getPrototypeOf(instance);
    const methodNames = metadataScanner.getAllMethodNames(prototype);

    for (const methodName of methodNames) {
      const handler = prototype[methodName] as object;
      const hasRoutePath = Reflect.hasMetadata(PATH_METADATA, handler);
      if (!hasRoutePath) {
        continue;
      }

      const classRef = wrapper.metatype as object;
      const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, classRef]);
      if (isPublic) {
        continue;
      }

      const capabilities = reflector.getAllAndOverride<unknown[]>(REQUIRES_CAPABILITY_KEY, [handler, classRef]);
      if (!capabilities || capabilities.length === 0) {
        const controllerName = wrapper.metatype?.name ?? 'UnknownController';
        throw new Error(
          `Route ${controllerName}.${methodName}() is neither @Public() nor annotated with @RequiresCapability(...) ` +
            `(arch §9.2 / §20 DoD: every non-public route must carry an explicit capability).`,
        );
      }
    }
  }
}
