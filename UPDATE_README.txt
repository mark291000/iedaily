IE Daily v1.5.0 - User Management database authorization fix

This update makes Supabase the only source of truth for User Management and App Admin authorization.
Hardcoded credentials remain only for the existing login validation flow; hardcoded names no longer grant App Admin permissions, and the User Management page no longer falls back to the static users list.

Replace these files in the matching paths:
1) index.html
2) js/modules/16-multiTeamSecurityV5.js
3) js/modules/20-multiTeamRolesV1.js

The ZIP also includes the two mirrored root-level JS source files for source-project consistency:
4) 16-multiTeamSecurityV5.js
5) 20-multiTeamRolesV1.js

After replacing files, deploy the updated project and hard-refresh the browser (Ctrl+F5).

Important:
- The logged-in user's `users.role` value in Supabase must be `Admin` for App Admin access.
- Team memberships and team-level roles are read from `user_team_roles`.
- Team names are read from `teams` and database-loaded application data.
- This patch does not alter Supabase schema or existing rows.
