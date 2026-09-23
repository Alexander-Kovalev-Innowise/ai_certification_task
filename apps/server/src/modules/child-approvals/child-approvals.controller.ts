import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { PaginatedResponseDto } from '../../shared/http/pagination.dto';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';

import { ChildPurchaseApprovalService } from './child-purchase-approval.service';
import { ApprovalRowDto } from './dto/approval-row.dto';
import { ListApprovalsQueryDto } from './dto/list-approvals-query.dto';
import { ResolveApprovalDto } from './dto/resolve-approval.dto';

// Task 5.12, first endpoint — extended in Task 5.13
// (approve/deny). `ChildPurchaseApproval` has no `trainerId`, so this
// controller carries no `X-Trainer-Context` handling anywhere (api §4.6).
@ApiTags('child-approvals')
@ApiBearerAuth()
@Controller('approvals')
export class ChildApprovalsController {
  constructor(private readonly childPurchaseApprovalService: ChildPurchaseApprovalService) {}

  // Task 5.12 (api §4.6 "GET /approvals", FR-040/FR-041).
  // `@RequiresCapability(APPROVE_CHILD_PURCHASE)` -> CHILD tokens get
  // `403 CHILD_CAPABILITY_DENIED` (api §0.7's resolved deny-list addition).
  @RequiresCapability(Capability.APPROVE_CHILD_PURCHASE)
  @Get()
  @ApiOperation({ summary: "List the caller's own children's purchase-approval requests" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: 'Denied for typ: CHILD tokens', schema: { example: { errorCode: 'CHILD_CAPABILITY_DENIED' } } })
  async listApprovals(
    @CurrentUser() ctx: AuthContext,
    @Query() query: ListApprovalsQueryDto,
  ): Promise<PaginatedResponseDto<ApprovalRowDto>> {
    return this.childPurchaseApprovalService.listApprovals(ctx, query);
  }

  // Task 5.13 (api §4.6 "POST /approvals/:id/approve", arch §9.3). Race-safe
  // conditional update — a row the expiry sweep just resolved concurrently
  // reports `409 CONFLICT`, never a silent no-op or double-transition.
  @RequiresCapability(Capability.APPROVE_CHILD_PURCHASE)
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a pending child purchase request (no charge here — Epic-05 subscribes to the event)' })
  @ApiResponse({ status: 200, type: ApprovalRowDto })
  @ApiResponse({ status: 403, description: 'Denied for typ: CHILD tokens', schema: { example: { errorCode: 'CHILD_CAPABILITY_DENIED' } } })
  @ApiResponse({ status: 404, description: 'Not found, or not the caller\'s child' })
  @ApiResponse({ status: 409, description: 'Already resolved or expired', schema: { example: { errorCode: 'CONFLICT' } } })
  async approve(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: ResolveApprovalDto,
  ): Promise<ApprovalRowDto> {
    return this.childPurchaseApprovalService.approve(ctx, id, dto.notes);
  }

  // Task 5.13 (api §4.6 "POST /approvals/:id/deny"). Same race-safe shape as approve.
  @RequiresCapability(Capability.APPROVE_CHILD_PURCHASE)
  @Post(':id/deny')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deny a pending child purchase request — notifies the child via email' })
  @ApiResponse({ status: 200, type: ApprovalRowDto })
  @ApiResponse({ status: 403, description: 'Denied for typ: CHILD tokens', schema: { example: { errorCode: 'CHILD_CAPABILITY_DENIED' } } })
  @ApiResponse({ status: 404, description: 'Not found, or not the caller\'s child' })
  @ApiResponse({ status: 409, description: 'Already resolved or expired', schema: { example: { errorCode: 'CONFLICT' } } })
  async deny(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: ResolveApprovalDto,
  ): Promise<ApprovalRowDto> {
    return this.childPurchaseApprovalService.deny(ctx, id, dto.notes);
  }
}
