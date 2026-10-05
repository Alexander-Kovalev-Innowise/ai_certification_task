// `GET /me/notifications` - NotificationsResponseDto (server derives the items).
export type NotificationKind =
  | 'APPROVAL_PENDING'
  | 'REQUEST_INFO_REQUESTED'
  | 'REQUEST_DECIDED'
  | 'OVERRIDE_NEW'
  | 'OVERRIDE_ACCEPTED'
  | 'OVERRIDE_CHANGE_REQUESTED';

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  read: boolean;
}

export interface NotificationsResponse {
  unreadCount: number;
  items: NotificationItem[];
}
