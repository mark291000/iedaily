IE DAILY — USERS & TEAM ACCESS FIX

This patch restores the database management controls that were hidden by the hardcodedUsersV1Style CSS rule.

Replace the root index.html with this file, then deploy/restart the app and press Ctrl+F5.

Restored controls:
- Add User (writes to Supabase users + user_team_roles)
- Import / Template (App Admin only)
- Add Team (writes to Supabase teams)
- Edit / Delete actions in the user table
- Show in reports toggle for App Admin

The existing 20-multiTeamRolesV1 logic already implements these operations. This patch removes the CSS rule that forcibly hid the buttons and disabled the Show toggle. It does not alter the database schema.

Note: Team edit/delete is not present in the current application code; this patch restores Create Team only. Team edit/delete requires a separate safe cascade design because team codes are referenced by user memberships and operational records.
