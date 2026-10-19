import sqlite3
import httpx
import pytest
from backend.database import connect, initialize, connection, backup_to
from backend.cloud_database import CloudDatabaseError, HTTPSession
from backend.auth import set_owner


def test_cloud_configuration_never_falls_back(tmp_path, monkeypatch):
    monkeypatch.setenv('DATA_DIR', str(tmp_path / 'unused'))
    for key in ('DB_BACKEND', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv('DB_BACKEND', 'turso')
    with pytest.raises(RuntimeError, match='local fallback is disabled'):
        connect()
    monkeypatch.setenv('TURSO_DATABASE_URL', 'libsql://missing-token.turso.io')
    with pytest.raises(RuntimeError):
        connect()
    assert not (tmp_path / 'unused').exists()


def test_remote_batch_rollback_and_persistence(turso_backend, tmp_path, monkeypatch):
    monkeypatch.setenv('DATA_DIR', str(tmp_path / 'never-created'))
    initialize()
    with connection(True) as db:
        for i in range(327):
            db.execute('INSERT INTO invoice_sequences VALUES(?,?)', (str(i), i+1))
    assert 327 in turso_backend.batches
    with connection() as db:
        assert db.execute('SELECT count(*) FROM invoice_sequences').fetchone()[0] == 327
    with pytest.raises(sqlite3.IntegrityError):
        with connection(True) as db:
            db.execute('INSERT INTO invoice_sequences VALUES(?,?)', ('new', 1))
            db.execute('INSERT INTO invoice_sequences VALUES(?,?)', ('0', 999))
            db.execute('INSERT INTO invoice_sequences VALUES(?,?)', ('skipped', 2))
    with connection() as db:
        assert db.execute("SELECT count(*) FROM invoice_sequences WHERE scope IN ('new','skipped')").fetchone()[0] == 0
        assert db.execute("SELECT next_number FROM invoice_sequences WHERE scope='0'").fetchone()[0] == 1
    assert not (tmp_path / 'never-created').exists()


def test_expired_transaction_cannot_flush_in_autocommit(turso_backend):
    initialize()
    db = connect()
    try:
        db.execute('BEGIN IMMEDIATE')
        db.execute('INSERT INTO invoice_sequences VALUES(?,?)', ('must-not-save', 1))
        db.db.execute('ROLLBACK')  # Server transaction disappeared/expired.
        with pytest.raises(CloudDatabaseError, match='expired'):
            db.execute('COMMIT')
    finally:
        db.close()
    with connection() as db:
        assert db.execute('SELECT count(*) FROM invoice_sequences').fetchone()[0] == 0


def test_network_failure_does_not_retry(turso_backend):
    initialize()
    db = connect()
    db.execute('BEGIN IMMEDIATE')
    db.execute('INSERT INTO invoice_sequences VALUES(?,?)', ('uncertain', 1))
    calls = []
    def fail(request):
        calls.append(request)
        raise httpx.ReadTimeout('simulated dropped response')
    db.session.http.close()
    db.session.http = httpx.Client(transport=httpx.MockTransport(fail))
    try:
        with pytest.raises(CloudDatabaseError):
            db.execute('COMMIT')
        assert len(calls) == 1
        assert not db.pending
    finally:
        db.close()


def test_cloud_full_backup_is_private_and_keeps_owner(turso_backend, tmp_path):
    initialize()
    set_owner('backup@example.test', 'Cloud backup test 2026!')
    with connection(True) as db:
        db.execute('INSERT INTO invoice_sequences VALUES(?,?)', ('test', 42))
    output = tmp_path / 'private-backup.sqlite3'
    backup_to(output)
    with sqlite3.connect(output) as db:
        assert db.execute('SELECT email FROM users').fetchone()[0] == 'backup@example.test'
        assert db.execute('SELECT next_number FROM invoice_sequences').fetchone()[0] == 42
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
    assert output.stat().st_mode & 0o777 == 0o600


def test_transport_refuses_plaintext_database_token():
    session = HTTPSession('http://unsafe.example', 'synthetic-token')
    try:
        with pytest.raises(RuntimeError, match='HTTPS'):
            session._post('/v3/pipeline', {})
    finally:
        session.http.close()


def test_server_stream_failure_is_reported_without_sql(turso_backend, monkeypatch):
    from turso_serverless.protocol import ServerError
    initialize()
    db = connect()
    db.execute('BEGIN IMMEDIATE')
    db.execute('INSERT INTO invoice_sequences VALUES(?,?)', ('private-label', 1))
    def reject(*args, **kwargs):
        raise ServerError('private SQL details', code='STREAM_EXPIRED')
    monkeypatch.setattr(db.session, 'execute_pipeline', reject)
    try:
        with pytest.raises(CloudDatabaseError) as error:
            db.execute('COMMIT')
        assert 'private' not in str(error.value)
    finally:
        db.close()


def test_render_https_always_uses_secure_session_cookie(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from backend.main import app
    for key in ('TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','DB_BACKEND','OWNER_PASSWORD'):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv('DATA_DIR', str(tmp_path))
    monkeypatch.setenv('APP_ENV', 'development')
    monkeypatch.setenv('RENDER_EXTERNAL_URL', 'https://billing.example.test')
    initialize()
    set_owner('https@example.test', 'Secure cookie test 2026!')
    with TestClient(app, base_url='https://billing.example.test') as client:
        response = client.post('/api/auth/login', json={'email':'https@example.test','password':'Secure cookie test 2026!'})
        assert response.status_code == 200
        assert '; Secure' in response.headers['set-cookie']
        assert '; HttpOnly' in response.headers['set-cookie']
        assert response.headers['strict-transport-security'].startswith('max-age=31536000')
        assert client.get('/api/auth/me').status_code == 200
