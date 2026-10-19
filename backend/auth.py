import hashlib
import hmac
import os
import secrets
import time
from fastapi import HTTPException, Request
from .database import connection, audit

COOKIE = "svs_session"
SESSION_HOURS = 12


def password_hash(password):
    if len(password) < 12 or len(password) > 256:
        raise ValueError("Use a password between 12 and 256 characters")
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return f"scrypt${salt}${digest}"


def password_matches(password, stored):
    try:
        scheme, salt, expected = stored.split("$")
        if scheme != "scrypt":
            return False
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def production():
    return os.getenv("APP_ENV", "development") == "production"


def set_owner(email, password):
    email = email.strip().lower()
    if "@" not in email or len(email)>254:
        raise ValueError("Provide a valid owner email")
    encoded = password_hash(password)
    with connection(True) as db:
        db.execute("INSERT INTO users VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,password_hash=excluded.password_hash", (email, encoded))
        db.execute("DELETE FROM sessions")
        audit(db, email, "Owner credentials configured")


def login(email, password, request, response):
    # A single-owner app: apply a persistent global throttle and an IP throttle.
    timestamp = int(time.time())
    ip = request.client.host if request.client else "unknown"
    keys = ["global", "ip:"+digest(ip)]
    with connection(True) as db:
        db.execute("DELETE FROM login_attempts WHERE started<?", (timestamp-900,))
        for key in keys:
            attempt = db.execute("SELECT count FROM login_attempts WHERE key=?", (key,)).fetchone()
            if attempt and attempt[0] >= (50 if key=="global" else 10):
                raise HTTPException(429, "Too many sign-in attempts. Try again in 15 minutes.")
        owner = db.execute("SELECT * FROM users WHERE id=1").fetchone()
        valid = owner and hmac.compare_digest(owner["email"], email.strip().lower()) and password_matches(password, owner["password_hash"])
        if not valid:
            # Do not raise inside the transaction: failed attempts must be committed.
            password_matches(password, "scrypt$"+"00"*16+"$"+"00"*64)
            for key in keys:
                db.execute("INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1", (key,timestamp))
        else:
            db.execute("DELETE FROM login_attempts WHERE key=?", (keys[1],))
            db.execute("DELETE FROM sessions WHERE expires<?", (timestamp,))
            token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            db.execute("INSERT INTO sessions VALUES(?,?,?)", (digest(token),csrf,timestamp+SESSION_HOURS*3600))
            audit(db, owner["email"], "Owner signed in")
    if not valid:
        raise HTTPException(401, "Email or password is incorrect")
    response.set_cookie(COOKIE, token, httponly=True, secure=production(), samesite="strict", max_age=SESSION_HOURS*3600, path="/")
    return {"email": owner["email"], "csrf": csrf}


def require_owner(request: Request):
    token = request.cookies.get(COOKIE, "")
    if not token or len(token)>100:
        raise HTTPException(401, "Please sign in")
    with connection() as db:
        session = db.execute("SELECT * FROM sessions WHERE token_hash=? AND expires>?", (digest(token),int(time.time()))).fetchone()
        owner = db.execute("SELECT email FROM users WHERE id=1").fetchone()
    if not session or not owner:
        raise HTTPException(401, "Session expired. Please sign in again")
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        if not hmac.compare_digest(request.headers.get("x-csrf-token", ""), session["csrf"]):
            raise HTTPException(403, "Session verification failed. Refresh and try again")
    return {"email": owner["email"], "csrf": session["csrf"]}
