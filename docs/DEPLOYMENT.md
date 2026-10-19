# Cloud deployment

## Free Render + Turso setup

The default Blueprint uses Render Free compute and a separate free Turso/libSQL database. Business records, settings, authentication, sessions and import previews are stored remotely. A Render disk is not required. Remain within both providers' free quotas and leave paid upgrades/overages disabled.

1. Create a free Turso account. Create a **libSQL** database using the default engine; leave the optional TursoDB rewrite disabled for this existing SQLite application. Choose a region near the Render service.
2. Create a read/write database token scoped to that database. Keep it private. Do not commit it or send it in a support chat.
3. Open [Deploy with Render](https://render.com/deploy?repo=https://github.com/sharshitha67r-max/svs-enterprises), or configure the existing Docker service.
4. Set the private environment values below. The Blueprint already supplies `DB_BACKEND=turso`, `APP_ENV=production` and `PORT=8000`.
5. Deploy. `/api/health` must return `{"status":"ok"}`. The owner is initialized only when the remote database has no owner yet.
6. Sign in at the Render HTTPS URL. Open **Backup / export → Load initial business data**, select the separately delivered private JSON package, review counts, then type `IMPORT`.
7. Check business settings, outstanding balances and a sample PDF. Download a private backup.
8. Restart/redeploy the service and confirm the same records remain. Sign-in and invoice numbers must also remain intact.

Render Free sleeps after inactivity and can take about a minute to start. It has monthly usage limits and no production uptime guarantee. Turso also has free storage/read/write limits. This setup suits light use; keep private off-host business backups and monitor quotas.

### Migrating an existing Render deployment

Before any restart, environment change or deployment, download a JSON backup from the existing app. A free Render service loses its local SQLite data when it stops. Do not assume the original workbook includes new invoices, payments or edits made since import.

Prepare and test the code first. Save the Turso variables privately in Render and deploy the matching code together. Import the existing business backup into the new **empty** database. Use the original prepared initial package only when the existing workspace has no business records. Verify counts and settings before using the app.

The app refuses to fall back to local SQLite if `DB_BACKEND=turso` is selected or either Turso credential is provided but the pair is incomplete. A cloud outage produces an error; the app does not silently save to a temporary local file or automatically retry financial writes.

## Runtime settings

| Variable | Purpose |
| --- | --- |
| `DB_BACKEND` | `turso` for cloud hosting; `sqlite` for local/persistent-disk use |
| `TURSO_DATABASE_URL` | The private libSQL database URL, using HTTPS or `libsql://` |
| `TURSO_AUTH_TOKEN` | Read/write token for only the app database |
| `APP_ENV` | `production` behind HTTPS; Render also enables production cookies automatically |
| `OWNER_EMAIL` | Initial owner email, only when no owner exists |
| `OWNER_PASSWORD` | Initial owner password; keep private; minimum 12 characters |
| `PUBLIC_URL` | Exact HTTPS origin; defaults to Render's `RENDER_EXTERNAL_URL` |
| `PORT` | Container port; defaults to 8000 |
| `DATA_DIR` | Local SQLite directory only; defaults to `data` outside Docker |

Changing `OWNER_PASSWORD` in Render does not reset an existing owner's password. To change credentials, run the interactive owner command from a private computer with the correct database environment:

```sh
python -m backend.manage owner
```

The command revokes existing sessions. Never pass passwords as command arguments. Once the database owner exists, the plaintext initialization password can be removed from the hosting environment.

## Database connection behavior

The pinned official `turso-serverless` Python driver connects directly to libSQL over HTTPS. The app uses no local replica. Foreign keys stay enabled; invoice numbering and financial writes use `BEGIN IMMEDIATE`. Write-only operations are batched before the next read or commit, with dependent steps skipped after an error. Imports and long invoices therefore avoid one network request per inserted row. Reads and commits verify that the original transaction is still active. An uncertain network response is never retried automatically.

Database tokens remain on the server. All business APIs require the owner session; writes also require CSRF verification and an allowed request origin. HTTPS sessions use Secure, HttpOnly, SameSite=Strict cookies. Business JSON backups exclude passwords, sessions and database tokens.

## Backups and recovery

Download business JSON backups regularly through **Backup / export** and keep them on a private computer. The management command can also make a consistent full SQLite backup from either backend:

```sh
python -m backend.manage backup /private/location/svs.sqlite3
```

A full database backup includes password hashes and session records: protect it like a credential. The file is written with private permissions. It is not stored in GitHub.

For a business JSON restore, stop the app and run from a private computer. For Turso, an explicit local recovery path is required:

```sh
python -m backend.manage restore /private/location/svs-backup.json \
  --recovery-file /private/location/before-restore.sqlite3
```

Restore preserves the current owner's password and revokes sessions. Do not run it against an active billing service. Check the recovered data before resuming.

## Local SQLite or another Docker host

Local SQLite remains available when Turso settings are absent and `DB_BACKEND` is unset or `sqlite`. Use a real persistent volume on a cloud Docker host:

```sh
docker build -t svs-billing .
docker run --env-file /private/svs.env -p 127.0.0.1:8000:8000 \
  --mount type=volume,src=svs-billing-data,dst=/app/data svs-billing
```

Set `DB_BACKEND=sqlite`, unset both Turso variables and persist `DATA_DIR`. A local SQLite database must never be used on Render Free. Paid Render services can use a persistent disk mounted at `/app/data`. Review provider charges before creating paid resources.

## Deployment verification

- Health endpoint succeeds and anonymous invoice access returns 401.
- The HTTPS response includes HSTS and the login cookie is Secure.
- Customer/item counts, historical totals and duplicate flags match the approved backup.
- Create a draft, finalize it, download its A4 PDF and record/void a test receipt.
- A stale edit is rejected, and concurrent finalization produces unique invoice numbers.
- A downloaded business backup contains no credentials.
- Records and owner access remain after a deployment restart.

Provider references: [Render Free limits](https://render.com/docs/free), [Turso pricing](https://turso.tech/pricing), [Python driver](https://docs.turso.tech/sdk/python/quickstart), [SQL over HTTP](https://docs.turso.tech/sdk/http/reference).
