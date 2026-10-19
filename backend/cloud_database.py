"""Remote-only Turso/libSQL access. No business data is cached on the host.

The pinned official driver handles values, cursors and stream state. This
adapter batches write-only statements to keep imports within Turso's short
transaction window. Reads flush pending writes; an error never retries a save.
"""
import sqlite3
from urllib.parse import urlsplit

import httpx
import turso_serverless as turso
from turso_serverless.connection import Connection
from turso_serverless.protocol import ProtocolError, ServerError, build_batch_step
from turso_serverless.session import Session


class CloudDatabaseError(RuntimeError):
    pass


class HTTPSession(Session):
    def __init__(self, url, token):
        super().__init__(url, auth_token=token)
        self.http = httpx.Client(timeout=15, follow_redirects=False)

    def _post(self, path, body):
        # Server routing hints must never send the database token over HTTP.
        target = urlsplit(self._base_url)
        if target.scheme != "https" or not target.hostname or target.username or target.password or target.query or target.fragment:
            self._reset_stream()
            raise ProtocolError("Cloud database requires an HTTPS endpoint")
        try:
            response = self.http.post(self._base_url + path, json=body, headers=self._headers())
            response.raise_for_status()
            return response.content
        except (httpx.HTTPError, ValueError):
            self._reset_stream()
            raise ProtocolError("Cloud database request could not be confirmed") from None


class TursoConnection:
    def __init__(self, url, token):
        self.session = HTTPSession(url, token)
        self.db = Connection(self.session, isolation_level=None)
        self.db.row_factory = turso.Row
        self.pending = []
        self.transaction_started = False

    @property
    def in_transaction(self):
        return self.db.in_transaction

    def _guard_transaction(self):
        if self.transaction_started and not self.in_transaction:
            self.pending.clear()
            raise CloudDatabaseError("The database transaction expired. Refresh your records before trying again.")

    def _flush(self):
        if not self.pending:
            return
        self._guard_transaction()
        pending, self.pending = self.pending, []
        steps = [build_batch_step(sql, args=list(args), want_rows=False,
                                 condition={"type": "ok", "step": i-1} if i else None)
                 for i, (sql, args) in enumerate(pending)]
        result = self.session.execute_pipeline([{"type": "batch", "batch": {"steps": steps}}])[0]
        if result.get("type") != "ok":
            self._raise_server_error(result.get("error", {}))
        batch = result.get("response", {}).get("result", {})
        errors = batch.get("step_errors")
        results = batch.get("step_results")
        if not isinstance(errors, list) or not isinstance(results, list) or len(results) != len(steps) or len(errors) != len(steps):
            raise CloudDatabaseError("The database save could not be confirmed. Refresh your records before trying again.")
        for error in errors:
            if error:
                self._raise_server_error(error)
        if any(row is None for row in results):
            raise CloudDatabaseError("The database save was interrupted. Refresh your records before trying again.")
        self._guard_transaction()

    @staticmethod
    def _raise_server_error(error):
        if str(error.get("code", "")).startswith("SQLITE_CONSTRAINT"):
            raise sqlite3.IntegrityError("Cloud database constraint conflict")
        raise CloudDatabaseError("The database save could not be completed. Refresh your records before trying again.")

    def execute(self, sql, parameters=()):
        command = sql.lstrip().split(None, 1)[0].upper()
        try:
            if command == "ROLLBACK":
                self.pending.clear()
                self.transaction_started = False
                return self.db.execute(sql, parameters)
            self._guard_transaction()
            if command in {"INSERT", "UPDATE", "DELETE", "REPLACE"} and self.transaction_started:
                # These application statements have no RETURNING clauses and
                # their cursors are unused. They are checked before any read.
                self.pending.append((sql, tuple(parameters)))
                return None
            self._flush()
            result = self.db.execute(sql, parameters)
            if command == "BEGIN":
                self.transaction_started = True
            elif command == "COMMIT":
                self.transaction_started = False
            return result
        except turso.IntegrityError:
            raise sqlite3.IntegrityError("Cloud database constraint conflict") from None
        except (turso.Error, ProtocolError, ServerError):
            raise CloudDatabaseError("The database operation could not be confirmed. Refresh your records before trying again.") from None

    def executescript(self, sql):
        if self.transaction_started:
            raise CloudDatabaseError("Schema changes cannot run during a save")
        try:
            return self.db.executescript(sql)
        except (turso.Error, ProtocolError, ServerError):
            raise CloudDatabaseError("The cloud database schema could not be initialized") from None

    def close(self):
        self.pending.clear()
        try:
            self.db.close()
        finally:
            self.session.http.close()
