export type GuestPermissionAction =
  | "read_home"
  | "read_board"
  | "read_card_comments"
  | "comment_card"
  | "create_board"
  | "receive_notification"
  | "update_own_card_status";

export type GuestNotificationReason = "direct_mention" | "assignment" | "watch" | "workspace";

export type GuestAccessInput = {
  role: "owner" | "admin" | "member" | "observer" | "guest";
  action: GuestPermissionAction;
  boardAssigned?: boolean;
  cardAssigned?: boolean;
  notificationReason?: GuestNotificationReason;
};

export function hasGuestAccess(input: GuestAccessInput): boolean {
  if (input.role !== "guest") return true;

  switch (input.action) {
    case "read_home":
      return true;
    case "read_board":
      return input.boardAssigned === true;
    case "read_card_comments":
      return input.boardAssigned === true || input.cardAssigned === true;
    case "comment_card":
      return input.cardAssigned === true;
    case "update_own_card_status":
      // Move (listId change) on a card where guest is in card_members.
      // Guests cannot self-assign — assignment comes from other roles.
      return input.cardAssigned === true;
    case "receive_notification":
      // #0112 — workspace guests receive no notifications at all
      // (mirrored at the DB layer by skipping public.emit_notification
      // for guest recipients).
      return false;
    case "create_board":
      return false;
    default:
      return false;
  }
}
