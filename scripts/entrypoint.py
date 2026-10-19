"""Make a mounted data directory writable, then run the server unprivileged."""
import os
from pathlib import Path

data=Path(os.environ.get('DATA_DIR','/app/data'))
data.mkdir(parents=True,exist_ok=True,mode=0o700)
if os.geteuid()==0:
    os.chown(data,10001,10001)
    os.setgroups([])
    os.setgid(10001)
    os.setuid(10001)
os.umask(0o077)
os.execvp('uvicorn',['uvicorn','backend.main:app','--host','0.0.0.0','--port',os.environ.get('PORT','8000'),'--workers','1','--no-server-header','--no-access-log'])
