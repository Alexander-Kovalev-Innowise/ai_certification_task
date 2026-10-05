export type NotificationKind =
  | 'APPROVAL_PENDING'
  | 'REQUEST_INFO_REQUESTED'
  | 'REQUEST_DECIDED'
  | 'OVERRIDE_NEW'
  | 'OVERRIDE_ACCEPTED'
  | 'OVERRIDE_CHANGE_REQUESTED';

export class NotificationItemDto {
  /** Stable key of the derived item (also the read-state key). */
  id!: string;
  kind!: NotificationKind;
  title!: string;
  body!: string;
  /** In-app route the item links to. */
  href!: string;
  createdAt!: string;
  read!: boolean;
}

export class NotificationsResponseDto {
  unreadCount!: number;
  items!: NotificationItemDto[];
}
