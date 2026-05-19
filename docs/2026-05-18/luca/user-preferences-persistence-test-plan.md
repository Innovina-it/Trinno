# User Preferences Persistence Test Plan

## Scope

Manual verification for server-side persistence of user-specific UI preferences.

This test plan covers:

- Workspace active tab redirect
- Roadmap zoom preference
- Roadmap Gantt/List view preference
- Board filters
- Board assignee visibility filter
- Board sprint strip visibility
- URL override behavior
- Cross-browser/session persistence
- Basic regression checks

Out of scope:

- Roadmap horizontal scroll persistence
- Removing `layoutDensity`

## Test Account

Use:

```text
Email: luca.de.crescenzo@innovina.it
Password: 12345678
```

## Setup

1. Log in with the test account.
2. Create a new workspace.
3. Create a new board inside that workspace.
4. Create at least 4 cards.
5. Add enough data to test filters:
   - One card assigned to the test user
   - One unassigned card
   - One card with a label
   - One card with a due date
   - One card with start and target dates for the roadmap

## Workspace Active Tab

1. Open `/w/{workspaceId}/roadmap`.
2. Open `/w/{workspaceId}`.
3. Expected: redirects to `/w/{workspaceId}/roadmap`.
4. Open `/w/{workspaceId}/boards`.
5. Open `/w/{workspaceId}`.
6. Expected: redirects to `/w/{workspaceId}/boards`.

## Workspace Switcher From Personal Pages

1. Open Home at `/me`.
2. Use the workspace switcher and select another workspace.
3. Expected: the app remains on `/me`.
4. Expected: it does not redirect to that workspace's saved `Board` or `Roadmap` tab.
5. Repeat from `/inbox`, `/timeline`, `/dashboards`, and `/workload` if those entries are available.
6. Expected: personal pages remain personal pages when switching workspace context.

When already inside a workspace route, switching workspace should still preserve the comparable workspace section where possible:

1. Open `/w/{workspaceId}/roadmap`.
2. Switch to another workspace.
3. Expected: opens `/w/{otherWorkspaceId}/roadmap`.
4. Open `/w/{workspaceId}/boards`.
5. Switch to another workspace.
6. Expected: opens `/w/{otherWorkspaceId}/boards`.

## Roadmap Zoom

1. Open the roadmap.
2. Change zoom, for example to `Month` or `Quarter`.
3. Reload the roadmap without `?zoom=` in the URL.
4. Expected: saved zoom is restored.
5. Open the roadmap with `?zoom=week`.
6. Expected: URL wins and roadmap shows `Week`.
7. Remove `?zoom=week`.
8. Expected: saved preference is restored.

## Roadmap View Mode

1. Open the roadmap.
2. Switch from `Gantt` to `List`.
3. Reload without `?view=`.
4. Expected: `List` is restored.
5. Switch back to `Gantt`.
6. Reload without `?view=`.
7. Expected: `Gantt` is restored.
8. Open URL with `?view=list`.
9. Expected: URL wins and `List` is shown.

## Roadmap Horizontal Scroll

1. Open the roadmap.
2. Scroll horizontally.
3. Reload.
4. Expected: exact horizontal scroll position is not restored.
5. Expected: roadmap still opens in a reasonable position around today.

This is correct because horizontal scroll is intentionally not persisted server-side.

## Board Filters

1. Open a board.
2. Apply a filter, for example type or label.
3. Reload the board without explicit query params.
4. Expected: the filter is restored.
5. Change the filter.
6. Reload.
7. Expected: the latest filter is restored.

## Assignee Visibility

1. In the board, select `Mine`.
2. Reload.
3. Expected: `Mine` remains active.
4. Select `All`.
5. Reload.
6. Expected: `All` remains active.
7. Select `Unassigned`.
8. Reload.
9. Expected: `Unassigned` remains active.

## URL Override For Filters

1. Save a personal board filter, for example `Mine`.
2. Open the same board with `?assignee=all`.
3. Expected: URL wins and `All` is active.
4. Open with `?assignee=none`.
5. Expected: `Unassigned` is active.
6. Open with explicit type or label query params.
7. Expected: URL query params win over saved preferences.

## Sprint Strip Visibility

1. Open a board.
2. Click the `Sprints` toggle.
3. Expected: sprint strip appears.
4. Reload the board.
5. Expected: sprint strip remains visible.
6. Hide the sprint strip.
7. Reload.
8. Expected: sprint strip remains hidden.
9. Open another board.
10. Expected: sprint strip preference is separate per board.

## Cross-Browser Or Cross-Session Persistence

1. In browser/session A, set:
   - Roadmap zoom
   - Roadmap Gantt/List view
   - Board filters
   - Assignee visibility
   - Sprint strip visibility
2. Open browser/session B with the same test account.
3. Expected: preferences are restored for the same workspace/board.

## Regression Checks

1. Login works.
2. Logout works.
3. Workspace navigation works.
4. Board page loads.
5. Board drag/drop still works.
6. Roadmap Gantt renders.
7. Roadmap List renders.
8. Board filters still filter cards correctly.
9. Shared URLs with query params still work.

## Notes

- URL params always override saved preferences.
- Roadmap horizontal scroll is intentionally not persisted.

## New Update to do

- save backlog and home and the more page as favorite page when you open the website
- save a specific card as a favorit when open a website (check what appened when deleated as favorite)
- save filter when open and close website