# Self-hosted backend

This folder holds the small Postgres, PostgREST, and GoTrue setup.

## Files

- `bootstrap.sql` creates the database roles and base grants.
- `post-migrate.sql` sets the final function owner and view grants.
- `make_keys.py` creates the JWT secret, JWT keys, and role passwords.
- `docker-compose.yml` runs PostgREST and GoTrue in Coolify.
- `backup.sh` creates local compressed database backups.

## Rollout

1. Create a private PostgreSQL 16 service in Coolify.
2. Set its memory limit to 256 MB.
3. Run `make db-keys` on a secure computer.
4. Save the output in the Coolify environment settings.
5. Set `DATABASE_URL`, `AUTHENTICATOR_PW`, and `AUTH_ADMIN_PW` locally.
6. Run `make db-bootstrap` as the Postgres superuser.
7. Create a Coolify Compose resource from `docker-compose.yml`.
8. Add all Compose environment variables from the next section.
9. Set the rest domain to `https://api.indoeuromap.com/rest/v1`.
10. Set the auth domain to `https://api.indoeuromap.com/auth/v1`.
11. Add the Cloudflare A record for `api.indoeuromap.com`.
12. Wait for the TLS certificate.
13. Start auth once.
14. Confirm that GoTrue created `auth.users`.
15. Run `make db-migrate` with the superuser `DATABASE_URL`.
16. Add `https://api.indoeuromap.com/auth/v1/callback` to Google OAuth.
17. Test Google sign-in on a preview frontend build.
18. Set the new public URL and anon key in the frontend Coolify settings.
19. Redeploy the frontend.
20. Test sign-in, voting, aggregate reads, and account deletion.
21. Install `backup.sh` on the VPS and add its cron line.
22. Create one backup and test one restore.
23. Delete the hosted Supabase project after all checks pass.

Do not put the service role key in the frontend.

## Compose environment

Set these values on the Coolify Compose resource:

- `PGRST_DB_URI`: The authenticator database URL.
- `PGRST_JWT_SECRET`: The generated `JWT_SECRET` value.
- `GOTRUE_API_EXTERNAL_URL`: `https://api.indoeuromap.com/auth/v1`.
- `GOTRUE_SITE_URL`: `https://indoeuromap.com`.
- `GOTRUE_URI_ALLOW_LIST`: `https://indoeuromap.com/auth/callback`.
- `GOTRUE_JWT_SECRET`: The generated `JWT_SECRET` value.
- `GOTRUE_JWT_EXP`: `3600`.
- `GOTRUE_JWT_DEFAULT_GROUP_NAME`: `authenticated`.
- `GOTRUE_JWT_AUD`: `authenticated`.
- `GOTRUE_DB_DRIVER`: `postgres`.
- `DATABASE_URL`: The `supabase_auth_admin` database URL.
- `GOTRUE_EXTERNAL_GOOGLE_ENABLED`: `true`.
- `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID`: The Google client ID.
- `GOTRUE_EXTERNAL_GOOGLE_SECRET`: The Google client secret.
- `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI`: The GoTrue callback URL.
- `GOTRUE_DISABLE_SIGNUP`: `false`.
- `GOTRUE_MAILER_AUTOCONFIRM`: `true`.
- `GOTRUE_EXTERNAL_EMAIL_ENABLED`: `false`.
- `GOTRUE_CORS_ALLOWED_HEADERS`: fixed in the compose file. supabase-js sends
  an `apikey` header. GoTrue does not allow it by default and the browser
  preflight fails. Hosted Supabase adds it through Kong. We do not run Kong.

The Compose file maps `GOTRUE_API_EXTERNAL_URL` to `API_EXTERNAL_URL`.
GoTrue v2.196.0 requires this container variable name.
The Compose file sets `DB_NAMESPACE=auth`.
GoTrue v2.196.0 requires this schema variable name.

The PostgREST image has no health check tool.
Set its Coolify health check to `http://rest:3000/`.

## Restore

Set `DB_CONTAINER`, `DB_USER`, and `DB_NAME`.
Run this command with the required backup file:

```bash
gunzip -c file.sql.gz | docker exec -i "$DB_CONTAINER" \
  psql -U "$DB_USER" "$DB_NAME"
```
