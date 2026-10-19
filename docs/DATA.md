# Data, imports and backups

## Storage

SQLite runs in WAL mode with foreign keys enabled. Tables separate customers, products (`items`), invoices, invoice items, payments, sequences, settings, sessions and audit records. Writes use `BEGIN IMMEDIATE` transactions; numbering and receipts are serialized. Each edit increments the invoice version to reject stale changes from another window.

Keep the database and WAL files together on persistent local storage. Run one app instance. If future requirements include several application replicas or a busy multi-user accounting system, migrate the persistence layer to a managed relational database before scaling out.

## Excel mapping

| Source sheet | App entity | Handling |
| --- | --- | --- |
| Customer | Customers | Name, place, city, state, PIN, phone, GSTIN; missing optional fields remain empty |
| Item | Items | Preserve descriptions; no rate extraction from embedded numbers |
| Orders | Historical invoices | Require meaningful invoice number, name, date and positive amount |
| Invoice | Reference layout | Used to reconstruct the PDF and acceptance calculation; not imported as another invoice automatically |

CSV uploads should use UTF-8 and the same named columns as the downloadable templates. Product “Name” headers are recognized only at the start of a product list; embedded header-like rows are flagged as suspicious.

Imports have a preview and a separate commit. Preview state expires after an hour. The commit uses stored preview data, not financial values returned by the browser. Importing consumes that preview so the same confirmation cannot be accidentally repeated.

Customer duplicates are flagged, never merged. Historical invoices link to an existing customer only when the name matches exactly one record. Ambiguous names retain their own snapshot and remain unlinked rather than being assigned to an arbitrary duplicate.

### Large legacy files

The original workbook contains over a million unused formula-filled Orders rows. The importer reads in streaming mode, scans up to 50,000 rows per selected sheet, and stops after 300 consecutive empty/formula-only rows. It reviews up to 10,000 meaningful records in one import. A notice appears if the remaining tail is not scanned. Data after a large blank gap or beyond these limits should be split into separate files. It does not claim that unscanned rows were verified blank.

Uploads are limited to 50 MB, expanded Excel ZIP contents to 512 MB, and workbook entry counts are bounded. Macro-enabled/legacy binary workbooks are not accepted. Formula errors such as `#N/A` are treated as unavailable values. Nothing evaluates workbook macros or formulas.

## Business JSON backup

```json
{
  "format": "svs-billing-backup",
  "version": 1,
  "currency": "INR",
  "money_unit": "paise",
  "created_at": "ISO-8601 timestamp",
  "tables": {
    "settings": [],
    "customers": [],
    "items": [],
    "invoices": [],
    "invoice_items": [],
    "payments": [],
    "invoice_sequences": [],
    "audit_logs": []
  }
}
```

Each table contains records with the column names from `backend/database.py`. Snapshot and settings fields are JSON strings, matching their database representation. Monetary integers represent paise, not rupees. This format preserves invoice IDs and relationships. Password hashes, sessions, pending import previews and environment secrets are excluded.

New empty deployments can load a business backup from Backup / export after owner sign-in. Loading requires a preview and typing `IMPORT`. This path rejects nonempty workspaces. Replacing an existing workspace uses the offline management command, which saves a recovery SQLite copy and invalidates sessions.

The optional migration helper prepares a private package from the supplied workbook:

```sh
python scripts/prepare_initial_data.py /private/source.xlsx \
  --output /private/SVS-initial-data.json \
  --review-output /private/SVS-import-review.json \
  --allow-duplicate-customers --historical-unpaid
```

Those flags explicitly preserve duplicate customer rows and treat accepted historical totals as unpaid. Omit them to hold those records for review. Keep outputs outside the public source checkout.

Excel exports neutralize formula-leading text so a customer name or note cannot become an executable spreadsheet formula. Exported numeric amounts remain typed numeric values.
