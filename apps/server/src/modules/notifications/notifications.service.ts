import { Injectable, NotFoundException } from '@nestjs/common';

import type { AuthContext } from '../../shared/security/auth-context.interface';

import type { NotificationItemDto, NotificationsResponseDto } from './dto/notification.dto';
import { NotificationsRepository } from './notifications.repository';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a decided request / accepted override stays in the feed. */
const RECENT_DECISION_DAYS = 14;
const CHANGE_REQUEST_DAYS = 30;
const MAX_ITEMS = 50;
const READ_MARKER_RETENTION_DAYS = 180;

type DraftItem = Omit<NotificationItemDto, 'read' | 'createdAt'> & { createdAt: Date };

function formatAmount(amount: { toString(): string }, paymentType: string): string {
  return paymentType === 'TOKEN' ? `${amount.toString()} tokens` : `$${amount.toString()}`;
}

function clip(text: string, max = 140): string {
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

// In-app notifications (US-01.05 "email + in-app", US-01.10). Items are DERIVED
// from live rows on every request, so an item disappears by itself the moment
// its cause resolves (an approval is decided, a coach accepts an override, ...).
// Only "seen" state is stored (NotificationRead, per user + item key). Item ids
// embed whatever makes a new occurrence distinct (e.g. a re-sent change request),
// so a fresh event on the same row is unread again.
@Injectable()
export class NotificationsService {
  constructor(private readonly repository: NotificationsRepository) {}

  async list(ctx: AuthContext): Promise<NotificationsResponseDto> {
    const drafts = (await this.derive(ctx)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, MAX_ITEMS);
    const readKeys = await this.repository.readKeys(
      ctx.userId,
      drafts.map((d) => d.id),
    );
    const items = drafts.map<NotificationItemDto>((d) => ({ ...d, createdAt: d.createdAt.toISOString(), read: readKeys.has(d.id) }));
    return { unreadCount: items.filter((item) => !item.read).length, items };
  }

  /** Marks one currently-listed item as seen. 404 for ids that are not in the caller's own feed (no junk rows). */
  async markRead(ctx: AuthContext, itemId: string): Promise<void> {
    const drafts = await this.derive(ctx);
    if (!drafts.some((d) => d.id === itemId)) {
      throw new NotFoundException({ message: 'Notification not found', errorCode: 'NOT_FOUND' });
    }
    if (this.isImpersonating(ctx)) {
      return;
    }
    await this.repository.markRead(ctx.userId, [itemId]);
    await this.pruneStaleMarkers();
  }

  async markAllRead(ctx: AuthContext): Promise<void> {
    if (this.isImpersonating(ctx)) {
      return;
    }
    const drafts = await this.derive(ctx);
    await this.repository.markRead(
      ctx.userId,
      drafts.map((d) => d.id),
    );
    await this.pruneStaleMarkers();
  }

  // A Super Admin impersonating a user must not change that user's seen-state.
  private isImpersonating(ctx: AuthContext): boolean {
    return ctx.impersonation !== undefined;
  }

  private async pruneStaleMarkers(): Promise<void> {
    await this.repository.pruneReadsBefore(new Date(Date.now() - READ_MARKER_RETENTION_DAYS * DAY_MS));
  }

  private async derive(ctx: AuthContext): Promise<DraftItem[]> {
    const now = Date.now();
    const recent = new Date(now - RECENT_DECISION_DAYS * DAY_MS);

    if (ctx.role === 'PLAYER_PARENT') {
      return ctx.accountType === 'CHILD' ? this.deriveForChild(ctx, recent) : this.deriveForGuardian(ctx);
    }
    if (ctx.role === 'TRAINER' && ctx.trainerId) {
      return this.deriveForTrainer(ctx.trainerId, recent, new Date(now - CHANGE_REQUEST_DAYS * DAY_MS));
    }
    if (ctx.role === 'COACH') {
      return this.deriveForCoach(ctx);
    }
    return [];
  }

  private async deriveForGuardian(ctx: AuthContext): Promise<DraftItem[]> {
    const rows = await this.repository.pendingApprovalsForParent(ctx.userId);
    return rows.map<DraftItem>((row) => ({
      id: `approval:${row.id}`,
      kind: 'APPROVAL_PENDING',
      title: `${row.playerProfile.name} needs your approval`,
      body: `${row.title ?? 'A purchase'} - ${formatAmount(row.amount, row.paymentType)}. Answer by ${row.expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
      href: '/approvals',
      createdAt: row.requestedAt,
    }));
  }

  private async deriveForChild(ctx: AuthContext, since: Date): Promise<DraftItem[]> {
    const rows = await this.repository.requestUpdatesForChild(ctx.userId, since);
    return rows.map<DraftItem>((row) => {
      const what = `${row.title ?? 'Your request'} (${formatAmount(row.amount, row.paymentType)})`;
      if (row.status === 'PENDING') {
        const askedAt = row.infoRequestedAt ?? row.requestedAt;
        return {
          id: `child-info:${row.id}:${askedAt.getTime()}`,
          kind: 'REQUEST_INFO_REQUESTED',
          title: 'Your parent has a question',
          body: clip(`${what}: ${row.infoRequestMessage ?? 'More information needed.'}`),
          href: '/requests',
          createdAt: askedAt,
        };
      }
      const decidedAt = row.respondedAt ?? row.expiresAt;
      const verdict = row.status === 'APPROVED' ? 'was approved' : row.status === 'DENIED' ? 'was denied' : 'expired';
      return {
        id: `child-decision:${row.id}`,
        kind: 'REQUEST_DECIDED',
        title: `Your request ${verdict}`,
        body: clip(row.parentNotes ? `${what}: ${row.parentNotes}` : what),
        href: '/requests',
        createdAt: decidedAt,
      };
    });
  }

  private async deriveForTrainer(trainerId: string, recent: Date, changeSince: Date): Promise<DraftItem[]> {
    const [changes, accepted] = await Promise.all([
      this.repository.openChangeRequestsForTrainer(trainerId, changeSince),
      this.repository.acceptedOverridesForTrainer(trainerId, recent),
    ]);
    const name = (row: { coach: { user: { firstName: string; lastName: string } } }): string =>
      `${row.coach.user.firstName} ${row.coach.user.lastName}`.trim();

    const items: DraftItem[] = [];
    for (const row of changes) {
      if (!row.changeRequestedAt) {
        continue;
      }
      items.push({
        id: `change-request:${row.id}:${row.changeRequestedAt.getTime()}`,
        kind: 'OVERRIDE_CHANGE_REQUESTED',
        title: `${name(row)} asked for a change`,
        body: clip(`${row.sessionLabel ? `${row.sessionLabel}: ` : ''}${row.changeRequestMessage ?? ''}`),
        href: '/coaches',
        createdAt: row.changeRequestedAt,
      });
    }
    for (const row of accepted) {
      if (!row.acknowledgedAt) {
        continue;
      }
      items.push({
        id: `override-accepted:${row.id}`,
        kind: 'OVERRIDE_ACCEPTED',
        title: `${name(row)} accepted the assignment`,
        body: clip(row.sessionLabel ?? row.reason),
        href: '/coaches',
        createdAt: row.acknowledgedAt,
      });
    }
    return items;
  }

  private async deriveForCoach(ctx: AuthContext): Promise<DraftItem[]> {
    const rows = await this.repository.unresolvedOverridesForCoach(ctx.userId);
    return rows.map<DraftItem>((row) => ({
      id: `override:${row.id}`,
      kind: 'OVERRIDE_NEW',
      title: `${row.trainer.businessName} scheduled you despite a conflict`,
      body: clip(`${row.sessionLabel ? `${row.sessionLabel}: ` : ''}${row.reason}`),
      href: '/my-times',
      createdAt: row.createdAt,
    }));
  }
}
