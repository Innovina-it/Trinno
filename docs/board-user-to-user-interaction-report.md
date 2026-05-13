# Board User-to-User Interaction Diagram Report

## Scope

Created `docs/board-user-to-user-interaction.svg` as a product interaction flow diagram for the board page. It focuses on how User A actions become visible to User B through UI collaboration mechanisms, not internal route/component architecture.

## Design Choices

- The diagram uses three vertical zones: `USER A`, `SHARED BOARD`, and `USER B`.
- The flow is split into five product lanes:
  - Presence: who is viewing the board or a card.
  - Shared board changes: moves, edits, completion, archive, labels, due dates.
  - Comments and mentions: comment creation, replies, mentions, notification fan-out.
  - Assignments and watchers: assignee changes, auto-watch behavior, inbox updates.
  - Activity feed: audit trail visible to collaborators.
- Arrows show that User A does not directly mutate User B's screen. User A writes through server actions/database changes; User B receives effects through Supabase Realtime, presence channels, activity sync, and notification subscriptions.

## Evidence From Local Code

- `components/board/board-view.tsx:131` wires board-level realtime with `useBoardRealtime`, and `components/board/board-view.tsx:137` wires presence with `useBoardPresence`.
- `hooks/use-board-presence.ts:20` creates the `board:{boardId}:presence` channel, and `hooks/use-board-presence.ts:39` tracks the current user with board/card location metadata.
- `components/board/presence-avatars.tsx:7` separates card viewers from board viewers, and `components/board/presence-avatars.tsx:18` renders hover text such as a user viewing a specific card.
- `components/board/board-view.tsx:221` and `components/board/board-view.tsx:338` optimistically move lists/cards locally before calling server actions. Failure handling appears at `components/board/board-view.tsx:228` and `components/board/board-view.tsx:376`.
- `actions/cards.ts:329` implements `moveCardImpl`, writing card list/position changes through `dbAsUser`.
- `hooks/use-board-realtime.ts:242` creates the board realtime channel. It subscribes to lists at `hooks/use-board-realtime.ts:245`, cards at `hooks/use-board-realtime.ts:275`, card members at `hooks/use-board-realtime.ts:356`, comments at `hooks/use-board-realtime.ts:419`, and other board-related tables afterwards.
- `components/board/card/comments-section.tsx:95` starts comment creation. It detects @mentions at `components/board/card/comments-section.tsx:99`, calls `createComment` at `components/board/card/comments-section.tsx:110`, updates local comments at `components/board/card/comments-section.tsx:115`, and shows mention notification feedback at `components/board/card/comments-section.tsx:127`.
- `actions/comments.ts:53` inserts comments through a server action implementation, and `actions/comments.ts:153` exposes the authenticated action that revalidates the board path.
- `supabase/migrations/0066_profile_handle.sql:99` auto-watches the comment author, `supabase/migrations/0066_profile_handle.sql:104` parses @handles, `supabase/migrations/0066_profile_handle.sql:109` emits `comment.mention`, and `supabase/migrations/0066_profile_handle.sql:120` sends `comment.create` to watchers who were not already mentioned.
- `components/board/card/members-section.tsx:21` toggles assigned members in the UI, and `components/board/card/members-section.tsx:25` performs an optimistic add/remove before calling `toggleCardMember`.
- `actions/card-members.ts:8` implements assignment toggling through `dbAsUser`.
- `supabase/migrations/0025_notify_triggers.sql:67` documents assignment notification behavior. `supabase/migrations/0025_notify_triggers.sql:72` emits `card.assigned`, and `supabase/migrations/0025_notify_triggers.sql:76` auto-watches the assigned user.
- `components/nav/notification-bell.tsx:68` fetches recent notifications, `components/nav/notification-bell.tsx:91` subscribes to the current user's notification channel, and `components/nav/notification-bell.tsx:101` refreshes/pulses on notification table changes.
- `supabase/migrations/0016_activity_triggers.sql:56` logs card updates, `supabase/migrations/0016_activity_triggers.sql:86` logs comment creation, and `supabase/migrations/0016_activity_triggers.sql:140` logs card member assignment.
- `components/board/activity-feed-sync.tsx:4` describes the render-less sync companion, and `hooks/use-activity-sync.ts:21` subscribes to `activity:{boardId}`. New activity rows call `router.refresh()` at `hooks/use-activity-sync.ts:32`.

## Evaluation

The diagram now matches the requested intent: user-to-user product interaction. It avoids code architecture nodes like routes, providers, and database schema internals unless they are necessary to explain the visible collaboration effect. The main limitation is that notifications are shown as a unified product loop; the exact recipient set varies by action type, watcher status, mention status, and user notification preferences.
