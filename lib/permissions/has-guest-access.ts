export type GuestPermissionAction =
  | "read_home"
  | "read_board"
  | "read_card_comments"
  | "comment_card"
  | "create_board"
  | "receive_notification";

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
    case "receive_notification":
      return (
        input.notificationReason === "direct_mention" ||
        input.notificationReason === "assignment"
      );
    case "create_board":
      return false;
    default:
      return false;
  }
}
