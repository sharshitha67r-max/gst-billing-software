# Cloud deployment

The app is ready to deploy from this repository. A live cloud service is created only after an owner connects a hosting account, sets private credentials and accepts any provider charges.

## Render Blueprint

1. Open [Deploy with Render](https://render.com/deploy?repo=https://github.com/sharshitha67r-max/svs-enterprises).
2. Connect the repository if requested.
3. Review the resources from `render.yaml`: a Docker web service and a 1 GB persistent disk. This configuration uses paid resources. Check the host's displayed pricing before creating them.
4. Set `OWNER_EMAIL` to the intended owner account and choose `OWNER_PASSWORD` privately. Use 12 or more characters. Do not paste that password into GitHub or a support chat.
5. Create the service. The app initializes its schema and owner on first startup. Render provides its external URL, which the app uses for same-origin checks.
6. Open the returned HTTPS URL and sign in.
7. Open **Backup / export → Load initial business data**, upload the separately delivered private JSON package, review its counts and type `IMPORT`.
8. Check Settings, opening balances and the first printed invoice before issuing new business invoices.

The database is under `/app/data`, matching the disk mount. A redeploy must retain this disk. Do not scale to multiple instances or workers. The container briefly sets permissions on the mounted directory, then drops to UID/GID 10001 before starting the application. Real credentials are never supplied as build arguments or written into the image.

The owner environment values initialize an empty database only. To change an existing owner's credentials, use the interactive management command in a host shell:

```sh
python -m backend.manage owner
```

Changing `OWNER_PASSWORD` in the host environment alone does not rotate a password already stored in the database. After initialization, the plaintext `OWNER_PASSWORD` environment value can be removed; the persistent database retains its password hash.

## Another Docker host

```sh
docker build -t svs-billing .
docker run --env-file /private/svs.env -p 127.0.0.1:8000:8000 \
  --mount type=volume,src=svs-billing-data,dst=/app/data svs-billing
```

Put an HTTPS reverse proxy in front of the container and set `PUBLIC_URL` to its exact public origin. Do not expose the database or use an ephemeral filesystem. For local Docker use, `compose.yaml` sets development cookie behavior and binds to loopback. Supply `OWNER_EMAIL` and `OWNER_PASSWORD` in your private shell or an ignored `.env` file.

## Runtime settings

| Variable | Purpose |
| --- | --- |
| `OWNER_EMAIL` | Initial owner email on an empty database |
| `OWNER_PASSWORD` | Initial password; keep private; minimum 12 characters |
| `DATA_DIR` | Persistent directory; defaults to `data` outside Docker |
| `APP_ENV` | Set `production` behind HTTPS to enable Secure cookies and HSTS |
| `PUBLIC_URL` | Exact HTTPS origin; falls back to Render's `RENDER_EXTERNAL_URL` |
| `PORT` | Container HTTP port; defaults to 8000 |

All APIs handling business data require an owner session. Sessions expire after 12 hours. Writes require a session-bound CSRF token, and cross-origin writes are rejected. The app uses no external analytics, fonts, CDN scripts or Emergent credentials.

## Backups and recovery

Download regular business JSON backups from the app. For a full database copy, use:

```sh
python -m backend.manage backup /private/svs.sqlite3
```

That command uses SQLite's backup API, which is safe with WAL mode. Copy the completed backup to private off-host storage. Do not copy only the live database file while ignoring its WAL.

To restore a business JSON backup, stop the server first and run:

```sh
python -m backend.manage restore /private/svs-backup.json
```

The command stores `before-restore.sqlite3` in `DATA_DIR`, restores business tables in a transaction, preserves the current owner credentials, and revokes sessions. Test a backup in a separate instance before relying on it for recovery.

## Deployment verification

- `/api/health` returns `{"status":"ok"}`.
- Anonymous access to `/api/invoices` returns 401.
- Sign-in works only for the configured owner.
- A sample invoice can be saved, downloaded and printed as an A4 PDF.
- A receipt updates the invoice balance and appears in the audit log.
- Data remains after a service restart.
- Download a backup and retain it privately.

Docker is not installed in the reconstruction workspace, so the Docker image must complete its first build on the chosen host. Local Python/API and browser checks are described in [verification](VERIFICATION.md).

Provider references: [Blueprint specification](https://render.com/docs/blueprint-spec), [persistent disks](https://render.com/docs/disks), [Docker services](https://render.com/docs/docker), [environment variables](https://render.com/docs/environment-variables).
