import { EventEmitter } from 'node:events';

import { Injectable } from '@nestjs/common';

// Task 3.7 (arch §11.2 point 5). A plain in-process EventEmitter is
// deliberately all Epic-01 needs — "a simple in-process event emitter is
// enough... nothing subscribes to it yet" (the plan's own words). Not
// `@nestjs/event-emitter`: that package isn't a dependency of this app
// (package.json), and pulling it in for a single unconsumed `emit()` call
// would add a dependency this phase doesn't need. A later epic that needs
// real subscribers can swap this for that package, or add `.on()` handlers
// directly against this same emitter, without changing gdprDelete()'s call
// site.
@Injectable()
export class DomainEventsEmitter extends EventEmitter {}
