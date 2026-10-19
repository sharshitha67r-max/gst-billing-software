"""Owner setup and offline backups. Never pass a password as a CLI argument."""
import argparse
import getpass
import json
import shutil
from pathlib import Path
from .database import initialize, connection, path, audit, now
from .auth import set_owner


def main():
    parser=argparse.ArgumentParser(description="Manage SVS Billing")
    parser.add_argument("command",choices=["owner","backup","restore"])
    parser.add_argument("file",nargs="?")
    parser.add_argument("--email")
    args=parser.parse_args()
    initialize()
    if args.command=="owner":
        email=args.email or input("Owner email: ").strip()
        password=getpass.getpass("New password (12+ characters): ")
        if password!=getpass.getpass("Confirm password: "):
            raise SystemExit("Passwords do not match")
        set_owner(email,password)
        print("Owner configured. Existing sessions have been revoked.")
    elif args.command=="backup":
        if not args.file:
            raise SystemExit("Specify an output path")
        import sqlite3
        with connection() as db,sqlite3.connect(args.file) as destination:
            db.backup(destination)
        Path(args.file).chmod(0o600)
        print("Database backup written. Store this file privately.")
    else:
        if not args.file:
            raise SystemExit("Specify a downloaded JSON backup")
        data=json.loads(Path(args.file).read_text())
        from .main import BACKUP_TABLES
        if data.get("format")!="svs-billing-backup" or data.get("version")!=1 or set(data.get("tables",{}))!=set(BACKUP_TABLES):
            raise SystemExit("Unsupported backup format")
        import sqlite3
        recovery=path().with_name("before-restore.sqlite3")
        with connection() as db,sqlite3.connect(recovery) as destination:
            db.backup(destination)
        recovery.chmod(0o600)
        with connection(True) as db:
            for table in reversed(BACKUP_TABLES):
                db.execute("DELETE FROM "+table)
            for table in BACKUP_TABLES:
                allowed={row[1] for row in db.execute("PRAGMA table_info("+table+")")}
                for row in data["tables"][table]:
                    if set(row)-allowed:
                        raise ValueError("Unknown fields in backup")
                    db.execute("INSERT INTO "+table+" ("+",".join(row)+") VALUES("+",".join("?" for _ in row)+")",list(row.values()))
            if db.execute("PRAGMA foreign_key_check").fetchall():
                raise ValueError("Backup contains invalid relationships")
            db.execute("DELETE FROM sessions")
            db.execute("DELETE FROM import_previews")
            audit(db,"Owner CLI","Backup restored",details={"time":now()})
        print("Backup restored. Previous database is saved as before-restore.sqlite3. Owner credentials were preserved.")


if __name__=="__main__":
    main()
