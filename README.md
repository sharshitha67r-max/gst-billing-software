# SVS Enterprises Billing

An independently rebuilt, single-owner billing app based on the supplied SVS specification and Excel invoice workflow. It does not depend on Emergent hosting or its MongoDB database.

The app includes customer and item masters, keyboard-friendly GST-inclusive invoicing, server-generated A4 PDFs, invoice history, drafts, payments, reports, Excel/CSV imports, Excel exports, backups and an audit log. It uses a FastAPI server, a modular browser interface with no build step, and SQLite on a persistent disk. Monetary amounts are stored as integer paise and calculated with Python `Decimal`.

## Run locally

Requires Python 3.13 or 3.14.

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m backend.manage owner
uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

The owner command asks for your email and a password privately. Use the agreed owner email when setting up the real deployment. Open <http://127.0.0.1:8000>. No default password, public registration or demo data is included.

## Cloud deployment

The repository includes a Dockerfile and a Render Blueprint with a persistent disk. Read [the deployment guide](docs/DEPLOYMENT.md) before deploying. The Render Blueprint provisions paid resources; review the provider's displayed charges yourself.

[Deploy with Render](https://render.com/deploy?repo=https://github.com/sharshitha67r-max/svs-enterprises)

Configure `OWNER_EMAIL` and `OWNER_PASSWORD` privately in the host's environment. Use HTTPS and `APP_ENV=production`. Persist `DATA_DIR`; keep one service instance and one application worker. GitHub Pages and ephemeral/serverless filesystems cannot run this database-backed app.

## Load the private initial data

The owner's prepared JSON migration backup is delivered separately, **outside this public repository**.

1. Sign in to a newly deployed, empty app.
2. Open **Backup / export → Load initial business data**.
3. Select the private initial-data JSON file.
4. Review the counts and type `IMPORT`.

Alternatively, use **Excel import** to upload the source workbook directly. Choose Customers, Items or Historical invoices, review the rows, and import only your selected records. The app supports the original large workbook and skips its formula-only tail.

The prepared migration keeps duplicate customer names separate, leaves product selling rates unset, and imports approved historical totals as Unpaid. Historical tax breakdowns remain unavailable. Incomplete historical rows and the header-like item row are delivered separately for review. Real customer, invoice and payment data must never be committed to this repository.

## Invoice workflow

Select a customer, search/select a product or enter a custom description, enter quantity and the GST-inclusive rate, then save or save and print. Defaults can be set in the Item Master. Numbers embedded in product names are not interpreted as prices.

| Shortcut | Action |
| --- | --- |
| Arrow keys, Enter | Select search results and move through invoice fields |
| Ctrl/Cmd+S | Save/finalize invoice |
| Ctrl/Cmd+Enter | Save and open the dedicated PDF for printing |
| Ctrl/Cmd+P | Open/print the invoice PDF |
| Alt+N | New invoice |
| Esc | Close dialog |

Some browser or OS shortcuts may take precedence. If a browser blocks a PDF popup or automatic print, use the invoice's Download PDF button and print from the PDF viewer.

## Calculation and data rules

See [calculation rules](docs/CALCULATIONS.md), [data format and import notes](docs/DATA.md), and [verification](docs/VERIFICATION.md).

- Rates include GST; default GST is 18%, split into CGST and SGST.
- The legacy “Discount” column is a configurable label for taxable value. Real discounts are a separate, optional feature.
- Final calculations run on the server; the browser displays the server result.
- Invoice numbers are allocated in a locked database transaction. Finalized invoices cannot be permanently deleted through the app.
- Saved invoices retain customer, product and business/print snapshots. Editing a master does not rewrite an invoice.
- Cancelling an invoice with recorded receipts requires voiding those receipt records with a reason first. This app records receipts; it does not initiate bank transfers or refunds.
- Version 1 uses the existing CGST/SGST intrastate workflow. IGST, Google sign-in, email delivery, inventory and full double-entry accounting are not configured in this rebuild.

## Tests

```sh
pip install -r requirements-dev.txt
pytest -q
npm run check
```

Node is used only for the optional JavaScript syntax check. Python tests exercise authentication, CSRF, rounding, concurrent numbering, immutable snapshots, payments, imports, backups and multi-page PDFs.

## Owner operations

```sh
# Set/reset the single owner's email/password. Revokes all sessions.
python -m backend.manage owner

# Consistent database backup (includes authentication; keep private).
python -m backend.manage backup /private/location/svs.sqlite3

# Restore an app-downloaded business JSON backup while the server is stopped.
python -m backend.manage restore /private/location/svs-backup.json
```

JSON business backups exclude passwords and sessions. Full SQLite backups contain password hashes and must be stored privately. Environment templates contain no real credentials.
