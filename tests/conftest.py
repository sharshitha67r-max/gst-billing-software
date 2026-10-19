"""A SQLite-backed Hrana v3 test peer for the pinned official remote driver."""
import json
import sqlite3
import uuid
import httpx
import pytest
from turso_serverless.protocol import decode_value, encode_value
from backend import cloud_database


class ProtocolPeer:
    def __init__(self, path):
        self.path = path
        self.connections = {}
        self.batches = []
        self.calls = 0

    def statement(self, db, stmt):
        args = [decode_value(v) for v in stmt.get('args', [])]
        cursor = db.execute(stmt['sql'], args)
        cols = [{'name': c[0]} for c in cursor.description or []]
        rows = [[encode_value(v) for v in r] for r in cursor.fetchall()] if cursor.description and stmt.get('want_rows', True) else []
        return {'cols': cols, 'rows': rows, 'affected_row_count': max(0, cursor.rowcount), 'last_insert_rowid': str(cursor.lastrowid) if cursor.lastrowid is not None else None}

    def condition(self, condition, db, successes):
        if condition is None:
            return True
        if condition['type'] == 'is_autocommit':
            return not db.in_transaction
        if condition['type'] == 'ok':
            return successes[condition['step']]
        raise AssertionError('Unexpected protocol condition')

    @staticmethod
    def error(exc):
        return {'code': getattr(exc, 'sqlite_errorname', 'SQLITE_ERROR'), 'message': str(exc)}

    def handle(self, request):
        self.calls += 1
        body = json.loads(request.content)
        baton = body.get('baton')
        if baton is None:
            baton = str(uuid.uuid4())
            self.connections[baton] = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False, timeout=15)
        db = self.connections[baton]
        if request.url.path == '/v3/cursor':
            entries = [{'baton': baton, 'base_url': None}]
            successes = []
            for i, step in enumerate(body['batch']['steps']):
                if not self.condition(step.get('condition'), db, successes):
                    successes.append(False)
                    continue
                try:
                    result = self.statement(db, step['stmt'])
                    entries.append({'type': 'step_begin', 'step': i, 'cols': result['cols']})
                    entries.extend({'type': 'row', 'row': r} for r in result['rows'])
                    entries.append({'type': 'step_end', 'affected_row_count': result['affected_row_count'], 'last_insert_rowid': result['last_insert_rowid']})
                    successes.append(True)
                except sqlite3.Error as exc:
                    entries.append({'type': 'step_error', 'step': i, 'error': self.error(exc)})
                    successes.append(False)
            return httpx.Response(200, text='\n'.join(json.dumps(e) for e in entries))
        assert request.url.path == '/v3/pipeline'
        results = []
        for operation in body['requests']:
            kind = operation['type']
            try:
                if kind == 'sequence':
                    db.executescript(operation['sql'])
                    response = {'type': kind}
                elif kind == 'get_autocommit':
                    response = {'type': kind, 'is_autocommit': not db.in_transaction}
                elif kind == 'batch':
                    steps = operation['batch']['steps']
                    self.batches.append(len(steps))
                    successes, step_results, step_errors = [], [], []
                    for step in steps:
                        if not self.condition(step.get('condition'), db, successes):
                            successes.append(False); step_results.append(None); step_errors.append(None)
                            continue
                        try:
                            step_results.append(self.statement(db, step['stmt']))
                            step_errors.append(None); successes.append(True)
                        except sqlite3.Error as exc:
                            step_results.append(None); step_errors.append(self.error(exc)); successes.append(False)
                    response = {'type': kind, 'result': {'step_results': step_results, 'step_errors': step_errors}}
                elif kind == 'close':
                    db.close()
                    self.connections.pop(baton)
                    baton = None
                    response = {'type': kind}
                else:
                    raise AssertionError('Unexpected pipeline operation')
                results.append({'type': 'ok', 'response': response})
            except sqlite3.Error as exc:
                results.append({'type': 'error', 'error': self.error(exc)})
        return httpx.Response(200, json={'baton': baton, 'base_url': None, 'results': results})

    def close(self):
        for db in self.connections.values():
            db.close()
        self.connections.clear()


@pytest.fixture
def turso_backend(tmp_path, monkeypatch):
    peer = ProtocolPeer(tmp_path / 'remote-test.sqlite3')
    original = cloud_database.HTTPSession

    def session(url, token):
        result = original(url, token)
        result.http.close()
        result.http = httpx.Client(transport=httpx.MockTransport(peer.handle))
        return result

    monkeypatch.setattr(cloud_database, 'HTTPSession', session)
    monkeypatch.setenv('DB_BACKEND', 'turso')
    monkeypatch.setenv('TURSO_DATABASE_URL', 'libsql://protocol-test.turso.io')
    monkeypatch.setenv('TURSO_AUTH_TOKEN', 'synthetic-test-token')
    yield peer
    peer.close()
