import json
import os
import sqlite3
import time
import uuid
from pathlib import Path
from contextlib import asynccontextmanager
from datetime import date, timedelta
from fastapi import FastAPI, Depends, Request, Response, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from . import auth, service, transfers
from .database import initialize, connection, settings, audit, now
from .money import BillingError, calculate
from .models import Login, Customer, Item, Invoice, Calculation, Payment, Reason, ImportCommit, BackupConfirm, DeleteConfirm
from .dates import report_date
from .documents import invoice_pdf, report_pdf
from .cloud_database import CloudDatabaseError

FRONTEND=Path(__file__).resolve().parent.parent/"frontend"
BACKUP_TABLES=["settings","customers","items","invoices","invoice_items","payments","invoice_sequences","audit_logs"]


@asynccontextmanager
async def lifespan(app):
    initialize()
    with connection() as db:
        exists=db.execute("SELECT 1 FROM users").fetchone()
    if not exists and os.getenv("OWNER_EMAIL") and os.getenv("OWNER_PASSWORD"):
        auth.set_owner(os.environ["OWNER_EMAIL"],os.environ["OWNER_PASSWORD"])
    yield


app=FastAPI(title="SVS Enterprises Billing",version="1.0.0",lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)


class LimitBody:
    def __init__(self,app):
        self.app=app
    async def __call__(self,scope,receive,send):
        if scope["type"]!="http":
            return await self.app(scope,receive,send)
        maximum=52*1024*1024 if scope.get("path") in {"/api/import/preview","/api/backup/preview"} else 2*1024*1024
        consumed=0
        async def limited_receive():
            nonlocal consumed
            message=await receive()
            consumed+=len(message.get("body",b""))
            if consumed>maximum:
                raise HTTPException(413,"Upload is too large")
            return message
        await self.app(scope,limited_receive,send)


app.add_middleware(LimitBody)


@app.middleware("http")
async def security(request,call_next):
    if request.method not in {"GET","HEAD","OPTIONS"}:
        origin=request.headers.get("origin")
        public=os.getenv("PUBLIC_URL",os.getenv("RENDER_EXTERNAL_URL","")).rstrip("/")
        allowed={public} if public else {str(request.base_url).rstrip("/")}
        if origin and origin.rstrip("/") not in allowed:
            return JSONResponse({"detail":"Request origin is not allowed"},status_code=403)
    response=await call_next(request)
    response.headers["X-Content-Type-Options"]="nosniff"
    response.headers["Referrer-Policy"]="same-origin"
    response.headers["X-Frame-Options"]="SAMEORIGIN"
    response.headers["Content-Security-Policy"]="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"]="no-store"
    if auth.production():
        response.headers["Strict-Transport-Security"]="max-age=31536000; includeSubDomains"
    return response


@app.exception_handler(BillingError)
async def billing_error(request,exc):
    return JSONResponse({"detail":str(exc)},status_code=400)


@app.exception_handler(sqlite3.IntegrityError)
async def conflict(request,exc):
    return JSONResponse({"detail":"This record conflicts with an existing record. Reload and try again."},status_code=409)


@app.exception_handler(CloudDatabaseError)
async def cloud_unavailable(request, exc):
    return JSONResponse({"detail":str(exc)},status_code=503)


def attachment(data,filename,media):
    return Response(content=data,media_type=media,headers={"Content-Disposition":f'attachment; filename="{filename}"'})


@app.get("/api/health")
def health():
    with connection() as db:
        db.execute("SELECT 1").fetchone()
    return {"status":"ok"}


@app.get("/api/auth/status")
def auth_status():
    with connection() as db:
        return {"configured":bool(db.execute("SELECT 1 FROM users").fetchone())}


@app.post("/api/auth/login")
def login(data:Login,request:Request,response:Response):
    return auth.login(data.email,data.password,request,response)


@app.get("/api/auth/me")
def me(owner=Depends(auth.require_owner)):
    return owner


@app.post("/api/auth/logout")
def logout(request:Request,response:Response,owner=Depends(auth.require_owner)):
    with connection(True) as db:
        db.execute("DELETE FROM sessions WHERE token_hash=?",(auth.digest(request.cookies.get(auth.COOKIE,"")),))
    response.delete_cookie(auth.COOKIE,path="/")
    return {"ok":True}


@app.get("/api/settings")
def read_settings(owner=Depends(auth.require_owner)):
    with connection() as db:
        return settings(db)


@app.put("/api/settings")
def write_settings(data:dict,owner=Depends(auth.require_owner)):
    return service.update_settings(data,owner["email"])


@app.get("/api/dashboard")
def dashboard(owner=Depends(auth.require_owner)):
    today=service.today();start=today[:7]+"-01"
    with connection() as db:
        sales="status NOT IN ('Draft','Cancelled')"
        result={"today":today,"sales_today":db.execute("SELECT coalesce(sum(total),0) FROM invoices WHERE "+sales+" AND invoice_date=?",(today,)).fetchone()[0],
                "sales_month":db.execute("SELECT coalesce(sum(total),0) FROM invoices WHERE "+sales+" AND invoice_date BETWEEN ? AND ?",(start,today)).fetchone()[0],
                "invoices_month":db.execute("SELECT count(*) FROM invoices WHERE "+sales+" AND invoice_date BETWEEN ? AND ?",(start,today)).fetchone()[0],
                "customers":db.execute("SELECT count(*) FROM customers WHERE active=1").fetchone()[0],
                "items":db.execute("SELECT count(*) FROM items WHERE active=1").fetchone()[0],
                "outstanding":db.execute("SELECT coalesce(sum(total-(SELECT coalesce(sum(amount),0) FROM payments WHERE invoice_id=i.id AND voided=0)),0) FROM invoices i WHERE "+sales).fetchone()[0],
                "drafts":db.execute("SELECT count(*) FROM invoices WHERE status='Draft'").fetchone()[0]}
        result["monthly"]=[dict(x) for x in db.execute("SELECT substr(invoice_date,1,7) AS month,sum(total) AS total FROM invoices WHERE "+sales+" AND invoice_date>=? GROUP BY substr(invoice_date,1,7) ORDER BY month",((date.fromisoformat(today)-timedelta(days=365)).isoformat(),))]
    result["recent"]=service.invoice_list(page_size=8)["rows"]
    return result


@app.get("/api/customers")
def customers(q:str=Query("",max_length=200),page:int=Query(1,ge=1),page_size:int=Query(50,ge=1,le=200),all_records:bool=False,owner=Depends(auth.require_owner)):
    return service.master_list("customers",q,page,page_size,all_records)


@app.post("/api/customers")
def create_customer(data:Customer,owner=Depends(auth.require_owner)):
    with connection(True) as db:
        return service.save_master(db,"customers",data.model_dump(),owner["email"])


@app.put("/api/customers/{identifier}")
def edit_customer(identifier:str,data:Customer,owner=Depends(auth.require_owner)):
    with connection(True) as db:
        service.require_row(db,"customers",identifier)
        return service.save_master(db,"customers",data.model_dump(),owner["email"],identifier)


@app.get("/api/customers/{identifier}")
def customer_profile(identifier:str,owner=Depends(auth.require_owner)):
    with connection() as db:
        customer=service.require_row(db,"customers",identifier)
        customer["summary"]=dict(db.execute("SELECT count(*) AS invoices,coalesce(sum(total),0) AS purchases,max(invoice_date) AS last_purchase,coalesce(sum(total-(SELECT coalesce(sum(amount),0) FROM payments WHERE invoice_id=i.id AND voided=0)),0) AS outstanding FROM invoices i WHERE customer_id=? AND status NOT IN ('Draft','Cancelled')",(identifier,)).fetchone())
    customer["invoices"]=service.invoice_list(customer_id=identifier,page_size=50)["rows"]
    return customer


@app.delete("/api/customers/{identifier}")
def delete_customer(identifier:str,data:DeleteConfirm,owner=Depends(auth.require_owner)):
    return service.delete_master("customers",identifier,owner["email"])


@app.get("/api/items")
def items(q:str=Query("",max_length=200),page:int=Query(1,ge=1),page_size:int=Query(50,ge=1,le=200),all_records:bool=False,owner=Depends(auth.require_owner)):
    return service.master_list("items",q,page,page_size,all_records)


@app.post("/api/items")
def create_item(data:Item,owner=Depends(auth.require_owner)):
    with connection(True) as db:
        return service.save_master(db,"items",data.model_dump(),owner["email"])


@app.put("/api/items/{identifier}")
def edit_item(identifier:str,data:Item,owner=Depends(auth.require_owner)):
    with connection(True) as db:
        service.require_row(db,"items",identifier)
        return service.save_master(db,"items",data.model_dump(),owner["email"],identifier)


@app.get("/api/items/{identifier}")
def item_profile(identifier:str,owner=Depends(auth.require_owner)):
    with connection() as db:
        item=service.require_row(db,"items",identifier)
        item["history"]=[dict(x) for x in db.execute("SELECT i.id,i.number,i.invoice_date,i.status,l.quantity,l.unit_price,json_extract(i.customer_snapshot,'$.name') AS customer FROM invoice_items l JOIN invoices i ON i.id=l.invoice_id WHERE l.item_id=? AND i.status NOT IN ('Draft','Cancelled') ORDER BY i.invoice_date DESC LIMIT 100",(identifier,))]
    return item


@app.delete("/api/items/{identifier}")
def delete_item(identifier:str,data:DeleteConfirm,owner=Depends(auth.require_owner)):
    return service.delete_master("items",identifier,owner["email"])


@app.post("/api/calculate")
def calculate_preview(data:Calculation,owner=Depends(auth.require_owner)):
    with connection() as db:
        conf=settings(db)
    return calculate([x.model_dump() for x in data.lines],conf["enable_discounts"])


@app.get("/api/invoices")
def invoices(q:str=Query("",max_length=200),start:str="",end:str="",status:str="",customer_id:str="",page:int=Query(1,ge=1),page_size:int=Query(50,ge=1,le=200),owner=Depends(auth.require_owner)):
    return service.invoice_list(q,start,end,status,customer_id,page,page_size)


@app.post("/api/invoices")
def create_invoice(data:Invoice,owner=Depends(auth.require_owner)):
    return service.save_invoice(data,owner["email"])


@app.get("/api/invoices/{identifier}")
def invoice_detail(identifier:str,owner=Depends(auth.require_owner)):
    with connection() as db:
        return service.invoice_dict(db,identifier)


@app.put("/api/invoices/{identifier}")
def edit_invoice(identifier:str,data:Invoice,owner=Depends(auth.require_owner)):
    return service.save_invoice(data,owner["email"],identifier)


@app.post("/api/invoices/{identifier}/cancel")
def cancel(identifier:str,data:Reason,owner=Depends(auth.require_owner)):
    return service.cancel_invoice(identifier,data.reason,owner["email"])


@app.get("/api/invoices/{identifier}/pdf")
def pdf(identifier:str,download:bool=True,owner=Depends(auth.require_owner)):
    with connection() as db:
        invoice=service.invoice_dict(db,identifier)
    return Response(invoice_pdf(invoice),media_type="application/pdf",headers={"Content-Disposition":('attachment' if download else 'inline')+f'; filename="invoice-{identifier[:8]}.pdf"'})


@app.get("/api/payments")
def payment_list(start:str="",end:str="",page:int=Query(1,ge=1),owner=Depends(auth.require_owner)):
    clauses=["1=1"];params=[]
    if start:
        clauses.append("p.payment_date>=?");params.append(service.valid_date(start))
    if end:
        clauses.append("p.payment_date<=?");params.append(service.valid_date(end))
    with connection() as db:
        where=" AND ".join(clauses)
        total=db.execute("SELECT count(*) FROM payments p WHERE "+where,params).fetchone()[0]
        rows=[dict(x) for x in db.execute("SELECT p.*,i.number,json_extract(i.customer_snapshot,'$.name') AS customer FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE "+where+" ORDER BY p.payment_date DESC,p.created_at DESC LIMIT 50 OFFSET ?",[*params,(page-1)*50])]
    return {"rows":rows,"total":total,"page":page,"page_size":50}


@app.post("/api/payments")
def add_payment(data:Payment,owner=Depends(auth.require_owner)):
    return service.save_payment(data,owner["email"])


@app.put("/api/payments/{identifier}")
def edit_payment(identifier:str,data:Payment,owner=Depends(auth.require_owner)):
    return service.save_payment(data,owner["email"],identifier)


@app.post("/api/payments/{identifier}/void")
def void_payment(identifier:str,data:Reason,owner=Depends(auth.require_owner)):
    return service.void_payment(identifier,data.reason,owner["email"])


@app.get("/api/reports/{kind}")
def reports(kind:str,start:str="",end:str="",format:str="json",owner=Depends(auth.require_owner)):
    data=service.report(kind,start,end)
    if format=="pdf":
        with connection() as db:
            conf=settings(db)
        return attachment(report_pdf(data,conf),"svs-report.pdf","application/pdf")
    if format=="xlsx":
        keys=[k for k in (data["rows"][0] if data["rows"] else ["label","total"]) if k!="id"]
        monetary={"taxable","cgst","sgst","rounding","total","paid","balance"}
        values=([None if row.get("historical") and k in {"taxable","cgst","sgst","rounding"} else row[k]/100 if k in monetary else report_date(kind,k,row[k],excel=True) for k in keys] for row in data["rows"])
        return attachment(transfers.workbook_bytes([k.title() for k in keys],values),"svs-report.xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    return data


@app.post("/api/import/preview")
async def preview(file:UploadFile=File(...),kind:str=Form(...),owner=Depends(auth.require_owner)):
    blob=await file.read(50*1024*1024+1)
    if len(blob)>50*1024*1024:
        raise HTTPException(413,"Use a file smaller than 50 MB")
    return transfers.preview_import(blob,file.filename or "",kind)


@app.post("/api/import/commit")
def import_commit(data:ImportCommit,owner=Depends(auth.require_owner)):
    return transfers.commit_import(data.preview_id,data.selected,owner["email"])


@app.get("/api/import/template/{kind}")
def template(kind:str,owner=Depends(auth.require_owner)):
    return attachment(transfers.template(kind),f"{kind}-template.xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.get("/api/export/{kind}")
def export(kind:str,owner=Depends(auth.require_owner)):
    return attachment(transfers.export_master(kind),f"svs-{kind}.xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.get("/api/backup")
def backup(owner=Depends(auth.require_owner)):
    with connection(True) as db:
        audit(db,owner["email"],"Full backup downloaded")
        result={"format":"svs-billing-backup","version":1,"created_at":now(),"currency":"INR","money_unit":"paise", "tables":{table:[dict(x) for x in db.execute("SELECT * FROM "+table)] for table in BACKUP_TABLES}}
    return attachment(json.dumps(result,ensure_ascii=False,indent=2).encode(),f"svs-backup-{service.today()}.json","application/json")


@app.get("/api/audit")
def audit_logs(page:int=Query(1,ge=1),owner=Depends(auth.require_owner)):
    with connection() as db:
        return {"rows":[dict(x) for x in db.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50 OFFSET ?",((page-1)*50,))],"page":page,"page_size":50,"total":db.execute("SELECT count(*) FROM audit_logs").fetchone()[0]}


@app.post("/api/backup/preview")
async def backup_preview(file:UploadFile=File(...),owner=Depends(auth.require_owner)):
    raw=await file.read(50*1024*1024+1)
    if len(raw)>50*1024*1024:
        raise HTTPException(413,"Use a backup smaller than 50 MB")
    try:
        data=json.loads(raw)
    except (ValueError,UnicodeError):
        raise BillingError("Upload a valid SVS JSON backup")
    if data.get("format")!="svs-billing-backup" or data.get("version")!=1 or data.get("money_unit")!="paise" or set(data.get("tables",{}))!=set(BACKUP_TABLES):
        raise BillingError("Unsupported backup format")
    with connection(True) as db:
        if any(db.execute("SELECT count(*) FROM "+table).fetchone()[0] for table in ["customers","items","invoices","payments"]):
            raise BillingError("Initial-data import requires an empty workspace. Use the offline restore command to replace existing data")
        for table,rows in data["tables"].items():
            if not isinstance(rows,list) or len(rows)>500000:
                raise BillingError("Invalid backup table")
            columns={r[1] for r in db.execute("PRAGMA table_info("+table+")")}
            for row in rows:
                if not isinstance(row,dict) or not row or set(row)-columns:
                    raise BillingError("Backup contains unknown fields")
        preview_id=str(uuid.uuid4())
        db.execute("INSERT INTO import_previews VALUES(?,?,?)",(preview_id,json.dumps({"kind":"backup","backup":data}),int(time.time())))
    return {"id":preview_id,"counts":{t:len(rows) for t,rows in data["tables"].items()},"created_at":data.get("created_at")}


@app.post("/api/backup/initialize")
def initialize_backup(data:BackupConfirm,owner=Depends(auth.require_owner)):
    if data.confirmation!="IMPORT":
        raise BillingError("Type IMPORT to confirm loading initial data")
    with connection(True) as db:
        if any(db.execute("SELECT count(*) FROM "+table).fetchone()[0] for table in ["customers","items","invoices","payments"]):
            raise BillingError("Initial-data import requires an empty workspace")
        saved=db.execute("SELECT data FROM import_previews WHERE id=? AND created_at>?",(data.preview_id,int(time.time())-3600)).fetchone()
        if not saved:
            raise BillingError("Backup preview expired")
        preview=json.loads(saved[0])
        if preview.get("kind")!="backup":
            raise BillingError("Wrong import preview type")
        tables=preview["backup"]["tables"]
        db.execute("DELETE FROM settings")
        db.execute("DELETE FROM audit_logs")
        for table in BACKUP_TABLES:
            for row in tables[table]:
                db.execute("INSERT INTO "+table+" ("+",".join(row)+") VALUES("+",".join("?" for _ in row)+")",list(row.values()))
        if db.execute("PRAGMA foreign_key_check").fetchall():
            raise BillingError("Backup relationships are invalid")
        if not db.execute("SELECT 1 FROM settings WHERE id=1").fetchone():
            raise BillingError("Backup is missing business settings")
        audit(db,owner["email"],"Initial business data imported",details={t:len(v) for t,v in tables.items()})
        db.execute("DELETE FROM import_previews WHERE id=?",(data.preview_id,))
    return {"ok":True}


app.mount("/assets",StaticFiles(directory=FRONTEND),name="assets")


@app.get("/{route:path}")
def frontend(route:str):
    if route.startswith("api/"):
        raise HTTPException(404,"API route not found")
    return FileResponse(FRONTEND/"index.html",headers={"Cache-Control":"no-cache"})
