import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';

import { AssociationsService } from './associations.service';
import { ContextListResponseDto } from './dto/context-list-response.dto';

// Task 5.7, first endpoint — extended in Tasks 5.8-5.10 (api §4.3's
// `AssociationsController`, the second owning module mounted under
// `/player-profiles`/`/me`/`/trainers`, per architect-architecture.md §2's
// "one resource surface, two owning modules" split). Empty `@Controller()`
// prefix — same reason ShareLinksController/CoachesController use one,
// this class mixes `/me/contexts`, `/player-profiles/:id/trainers` and
// `/trainers/:id/players` paths.
@ApiTags('associations')
@ApiBearerAuth()
@Controller()
export class AssociationsController {
  constructor(private readonly associationsService: AssociationsService) {}

  // Task 5.7 (api §4.3 "GET /me/contexts", FR-034).
  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Get('me/contexts')
  @ApiOperation({ summary: 'List every active (playerProfile, trainer) context — populates the trainer-context switcher' })
  @ApiResponse({ status: 200, type: ContextListResponseDto })
  async listContexts(@CurrentUser() ctx: AuthContext): Promise<ContextListResponseDto> {
    return this.associationsService.listContextsForUser(ctx);
  }
}
