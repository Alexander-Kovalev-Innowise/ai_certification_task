import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { PaginatedResponseDto } from '../../shared/http/pagination.dto';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';

import { ChildPurchaseApprovalService } from './child-purchase-approval.service';
import { ApprovalRowDto } from './dto/approval-row.dto';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';
import { ListApprovalsQueryDto } from './dto/list-approvals-query.dto';

// The child's side of the approval flow. CHILD tokens are the only callers
// that may use it (the service rejects ADULT tokens with 403 FORBIDDEN);
// `EDIT_OWN_PROFILE` is simply a capability CHILD tokens hold, needed because
// every non-public route must carry one (boot-time assertion).
@ApiTags('child-approvals')
@ApiBearerAuth()
@Controller('me/purchase-requests')
export class ChildPurchaseRequestsController {
  constructor(private readonly childPurchaseApprovalService: ChildPurchaseApprovalService) {}

  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Post()
  @ApiOperation({ summary: 'Child asks the guardian to approve a purchase (stand-in for the Epic-02/05 checkout hook)' })
  @ApiResponse({ status: 201, type: ApprovalRowDto })
  @ApiResponse({ status: 403, description: 'Not a CHILD token' })
  async create(@CurrentUser() ctx: AuthContext, @Body() dto: CreatePurchaseRequestDto): Promise<ApprovalRowDto> {
    return this.childPurchaseApprovalService.createPurchaseRequest(ctx, dto);
  }

  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Get()
  @ApiOperation({ summary: "List the child's own purchase requests with their status" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: 'Not a CHILD token' })
  async list(@CurrentUser() ctx: AuthContext, @Query() query: ListApprovalsQueryDto): Promise<PaginatedResponseDto<ApprovalRowDto>> {
    return this.childPurchaseApprovalService.listOwnRequests(ctx, query);
  }
}
