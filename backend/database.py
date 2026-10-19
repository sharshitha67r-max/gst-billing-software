import json
import os
import sqlite3
import re
from pathlib import Path
from contextlib import contextmanager
from datetime import datetime, timezone

DEFAULTS = {
    "business_name": "SVS ENTERPRISES", "address": "",
    "city": "", "state": "Karnataka", "state_code": "29", "pincode": "",
    "gstin": "", "pan": "", "phone": "", "email": "",
    "bank_details": "", "upi": "", "logo": "", "signatory": "Authorised Signatory", "receiver_label": "Receiver Signature",
    "terms": "Payment should be done within next delivery",
    "declaration": "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
    "footer": "", "invoice_prefix": "", "next_invoice_number": 1, "number_padding": 0,
    "reset_financial_year": False, "include_financial_year": False, "default_gst": "18",
    "prices_include_gst": True, "show_hsn": False, "show_phone": True, "show_gstin": True,
    "show_taxable": True, "legacy_labels": False, "show_receiver": True, "show_signatory": True,
    "enable_discounts": False,
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY CHECK(id=1), email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY, count INTEGER NOT NULL, started INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY, name TEXT NOT NULL, place TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '', pincode TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', gstin TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS customers_name ON customers(name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', default_rate INTEGER, gst_rate TEXT NOT NULL DEFAULT '18', unit TEXT NOT NULL DEFAULT 'Nos', hsn TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS items_name ON items(name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY, number TEXT UNIQUE, invoice_date TEXT NOT NULL, due_date TEXT, customer_id TEXT REFERENCES customers(id), customer_snapshot TEXT NOT NULL, business_snapshot TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('Draft','Unpaid','Partially Paid','Paid','Cancelled')), taxable INTEGER NOT NULL, cgst INTEGER NOT NULL, sgst INTEGER NOT NULL, rounding INTEGER NOT NULL, total INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, terms TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', tax_groups TEXT NOT NULL, historical INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS invoices_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS invoices_customer ON invoices(customer_id, invoice_date);
CREATE INDEX IF NOT EXISTS invoices_status ON invoices(status, invoice_date);
CREATE TABLE IF NOT EXISTS invoice_items(id INTEGER PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, position INTEGER NOT NULL, item_id TEXT REFERENCES items(id), description TEXT NOT NULL, quantity TEXT NOT NULL, unit_price INTEGER NOT NULL, gst_rate TEXT NOT NULL, unit TEXT NOT NULL, hsn TEXT NOT NULL, discount_percent TEXT NOT NULL, discount INTEGER NOT NULL, amount INTEGER NOT NULL, taxable INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS lines_invoice ON invoice_items(invoice_id,position);
CREATE INDEX IF NOT EXISTS lines_item ON invoice_items(item_id);
CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), payment_date TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), method TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', voided INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS payments_invoice ON payments(invoice_id,voided);
CREATE TABLE IF NOT EXISTS invoice_sequences(scope TEXT PRIMARY KEY, next_number INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT, details TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS import_previews(id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL);
"""


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def path():
    return Path(os.getenv("DATA_DIR", "data")) / "svs.sqlite3"


def connect():
    p = path()
    p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    db = sqlite3.connect(p, timeout=15, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.create_function("normalized_name",1,lambda value:re.sub(r"[^a-z0-9]","",str(value or "").lower()),deterministic=True)
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA journal_mode=WAL")
    return db


def initialize():
    with connection() as db:
        db.executescript(SCHEMA)
        db.execute("INSERT OR IGNORE INTO settings VALUES(1,?)", (json.dumps(DEFAULTS),))
    try:
        path().chmod(0o600)
    except OSError:
        pass


@contextmanager
def connection(write=False):
    db = connect()
    try:
        if write:
            db.execute("BEGIN IMMEDIATE")
        yield db
        if write:
            db.execute("COMMIT")
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise
    finally:
        db.close()


def settings(db):
    return DEFAULTS | json.loads(db.execute("SELECT data FROM settings WHERE id=1").fetchone()[0])


def audit(db, actor, action, entity_id=None, details=None):
    db.execute("INSERT INTO audit_logs(actor,action,entity_id,details,created_at) VALUES(?,?,?,?,?)",
               (actor, action, entity_id, json.dumps(details or {}), now()))
