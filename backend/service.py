import json
import uuid
import re
from collections import Counter
from datetime import date, datetime
from zoneinfo import ZoneInfo
from .database import connection, settings, audit, now, DEFAULTS
from .money import calculate, decimal, paise, BillingError, amount_words


def today():
    return datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat()


def valid_date(value, label="date"):
    try:
        d = date.fromisoformat(value)
        if not 1900 <= d.year <= 2199:
            raise ValueError()
        return d.isoformat()
    except (ValueError, TypeError):
        raise BillingError(f"Invalid {label}")


def require_row(db, table, identifier):
    if table not in {"customers", "items", "invoices", "payments"}:
        raise RuntimeError("Unknown entity")
    row = db.execute(f"SELECT * FROM {table} WHERE id=?", (identifier,)).fetchone()
    if not row:
        raise BillingError("Record not found")
    return dict(row)


def normalized_name(value):
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def save_master(db, kind, data, actor, identifier=None, read_back=True):
    if kind not in {"customers","items"} or not data.get("name","").strip():
        raise BillingError("A customer or item needs a name")
    old = db.execute(f"SELECT id FROM {kind} WHERE id=?", (identifier,)).fetchone() if identifier else None
    identifier = identifier or str(uuid.uuid4())
    if kind == "items":
        data["default_rate"] = paise(data["default_rate"]) if data.get("default_rate") not in (None, "") else None
        data["gst_rate"] = str(decimal(data.get("gst_rate",18), "GST rate", maximum=100))
    data["active"] = int(data.get("active",True))
    data["updated_at"] = now()
    if old:
        db.execute(f"UPDATE {kind} SET " + ",".join(f"{key}=?" for key in data) + " WHERE id=?", [*data.values(),identifier])
    else:
        data = {"id": identifier, **data, "created_at": now()}
        db.execute(f"INSERT INTO {kind} ("+",".join(data)+") VALUES("+",".join("?" for _ in data)+")", list(data.values()))
    audit(db, actor, ("Updated " if old else "Created ")+kind, identifier)
    return require_row(db, kind, identifier) if read_back else {"id": identifier, **data}


def master_list(kind, q="", page=1, page_size=50, all_records=False):
    if kind not in {"customers","items"}:
        raise BillingError("Unknown master")
    columns = ["name","description","hsn"] if kind=="items" else ["name","place","city","phone","gstin"]
    where = "("+" OR ".join(f"{x} LIKE ? ESCAPE '\\'" for x in columns)+")"
    term = "%"+q.replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%"
    params = [term]*len(columns)
    if not all_records:
        where += " AND active=1"
    with connection() as db:
        count = db.execute(f"SELECT COUNT(*) FROM {kind} WHERE {where}",params).fetchone()[0]
        rows = [dict(x) for x in db.execute(f"SELECT * FROM {kind} WHERE {where} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?",[*params,page_size,(page-1)*page_size])]
        if kind=="customers":
            names = Counter(normalized_name(x[0]) for x in db.execute("SELECT name FROM customers"))
            for row in rows:
                row["duplicate"] = names[normalized_name(row["name"])] > 1
    return {"rows":rows,"total":count,"page":page,"page_size":page_size}


def update_settings(data, actor):
    if not isinstance(data,dict) or set(data)-set(DEFAULTS):
        raise BillingError("Unknown setting")
    with connection(True) as db:
        current = settings(db)
        for k,v in data.items():
            if isinstance(DEFAULTS[k], bool):
                if not isinstance(v, bool):
                    raise BillingError(f"{k} must be true or false")
            elif isinstance(DEFAULTS[k], int):
                if isinstance(v,bool) or not isinstance(v,int) or v<0 or v>1000000000:
                    raise BillingError(f"Invalid {k}")
            elif not isinstance(v,str) or len(v)>(300000 if k=="logo" else 4000):
                raise BillingError(f"Invalid {k}")
        current.update(data)
        if not current["business_name"].strip() or current["next_invoice_number"]<1 or current["number_padding"]>12:
            raise BillingError("Business name, next number and padding must be valid")
        if not current["prices_include_gst"]:
            raise BillingError("Version 1 uses GST-inclusive prices")
        decimal(current["default_gst"],"GST rate",maximum=100)
        logo=current.get("logo","")
        if logo and not logo.startswith(("data:image/png;base64,","data:image/jpeg;base64,")):
            raise BillingError("Use a PNG or JPEG logo")
        db.execute("UPDATE settings SET data=? WHERE id=1",(json.dumps(current),))
        audit(db,actor,"Business settings updated",details={"fields":list(data)})
        return current


def next_number(db, conf, invoice_date):
    year = date.fromisoformat(invoice_date).year - (date.fromisoformat(invoice_date).month<4)
    fy = f"{year}-{str(year+1)[-2:]}"
    scope = f"{conf['invoice_prefix']}:{fy if conf['reset_financial_year'] else 'all'}"
    row = db.execute("SELECT next_number FROM invoice_sequences WHERE scope=?",(scope,)).fetchone()
    start = int(conf["next_invoice_number"])
    n = max(start,row[0] if row else start)
    # Yearly numbering stays globally unique by including the financial year.
    prefix = conf["invoice_prefix"]
    if conf["include_financial_year"] or conf["reset_financial_year"]:
        prefix += fy+"/"
    while True:
        number=prefix+str(n).zfill(conf["number_padding"])
        if not db.execute("SELECT 1 FROM invoices WHERE number=?",(number,)).fetchone():
            break
        n+=1
    db.execute("INSERT INTO invoice_sequences VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET next_number=excluded.next_number",(scope,n+1))
    # Separate sequences handle resets; do not carry last year's number into a new year.
    if not conf["reset_financial_year"]:
        conf["next_invoice_number"]=n+1
        db.execute("UPDATE settings SET data=? WHERE id=1",(json.dumps(conf),))
    return number


def invoice_dict(db, identifier):
    row = require_row(db,"invoices",identifier)
    for key in ["customer_snapshot","business_snapshot","tax_groups"]:
        row[key] = json.loads(row[key])
    row["lines"] = [dict(x) for x in db.execute("SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY position",(identifier,))]
    row["payments"] = [dict(x) for x in db.execute("SELECT * FROM payments WHERE invoice_id=? ORDER BY payment_date,created_at",(identifier,))]
    row["paid"] = sum(x["amount"] for x in row["payments"] if not x["voided"])
    row["balance"] = 0 if row["status"] in {"Draft","Cancelled"} else row["total"]-row["paid"]
    row["amount_words"] = amount_words(row["total"])
    return row


def save_invoice(payload, actor, identifier=None):
    data=payload.model_dump()
    invoice_date=valid_date(data["invoice_date"],"invoice date")
    due=valid_date(data["due_date"],"due date") if data["due_date"] else None
    if due and due<invoice_date:
        raise BillingError("Due date cannot be before invoice date")
    with connection(True) as db:
        conf=settings(db)
        totals=calculate(data["lines"],conf["enable_discounts"])
        customer=require_row(db,"customers",data["customer_id"])
        old=require_row(db,"invoices",identifier) if identifier else None
        if old:
            if old["status"]=="Cancelled" or old["historical"]:
                raise BillingError("Cancelled and historical invoices cannot be edited")
            if data["version"]!=old["version"]:
                raise BillingError("This invoice changed in another window. Reload it before saving")
            number=old["number"]
            final=old["status"]!="Draft" or data["finalize"]
            customer_snapshot=old["customer_snapshot"] if old["customer_id"]==customer["id"] and old["status"]!="Draft" else json.dumps(customer)
            business_snapshot=old["business_snapshot"] if old["status"]!="Draft" else json.dumps(conf)
        else:
            identifier=str(uuid.uuid4())
            number=None
            final=data["finalize"]
            customer_snapshot=json.dumps(customer)
            business_snapshot=json.dumps(conf)
        paid=db.execute("SELECT coalesce(sum(amount),0) FROM payments WHERE invoice_id=? AND voided=0",(identifier,)).fetchone()[0]
        if totals["total"]<paid:
            raise BillingError("Invoice total cannot be less than recorded payments")
        if final and totals["total"]<=0:
            raise BillingError("A finalized invoice must have a positive total")
        if not number and final:
            number=next_number(db,conf,invoice_date)
        status=("Paid" if paid>=totals["total"] else "Partially Paid" if paid else "Unpaid") if final else "Draft"
        values={"number":number,"invoice_date":invoice_date,"due_date":due,"customer_id":customer["id"],"customer_snapshot":customer_snapshot,"business_snapshot":business_snapshot,
                "status":status, **{x:totals[x] for x in ["taxable","cgst","sgst","rounding","total","discount"]},
                "terms":data["terms"],"notes":data["notes"],"tax_groups":json.dumps(totals["tax_groups"]),"updated_at":now()}
        if old:
            values["version"]=old["version"]+1
            db.execute("UPDATE invoices SET "+",".join(k+"=?" for k in values)+" WHERE id=?",[*values.values(),identifier])
            db.execute("DELETE FROM invoice_items WHERE invoice_id=?",(identifier,))
        else:
            values={"id":identifier,**values,"created_at":now()}
            db.execute("INSERT INTO invoices ("+",".join(values)+") VALUES("+",".join("?" for _ in values)+")",list(values.values()))
        item_ids = {line["item_id"] for line in totals["lines"] if line["item_id"]}
        if item_ids:
            found = {r[0] for r in db.execute("SELECT id FROM items WHERE id IN ("+",".join("?" for _ in item_ids)+")", list(item_ids))}
            if found != item_ids:
                raise BillingError("Record not found")
        for position,line in enumerate(totals["lines"]):
            values={"invoice_id":identifier,"position":position,**line}
            db.execute("INSERT INTO invoice_items ("+",".join(values)+") VALUES("+",".join("?" for _ in values)+")",list(values.values()))
        audit(db,actor,"Invoice edited" if old else "Invoice created",identifier,{"number":number,"status":status,"total":totals["total"]})
        return invoice_dict(db,identifier)


def invoice_list(q="",start="",end="",status="",customer_id="",page=1,page_size=50):
    where,params=["1=1"],[]
    if start:
        where.append("i.invoice_date>=?");params.append(valid_date(start))
    if end:
        where.append("i.invoice_date<=?");params.append(valid_date(end))
    if status:
        where.append("i.status=?");params.append(status)
    if customer_id:
        where.append("i.customer_id=?");params.append(customer_id)
    if q:
        term="%"+q+"%"
        where.append("(i.number LIKE ? OR i.customer_snapshot LIKE ? OR cast(i.total/100.0 as TEXT) LIKE ?)")
        params.extend([term,term,term])
    condition=" AND ".join(where)
    with connection() as db:
        count=db.execute("SELECT count(*) FROM invoices i WHERE "+condition,params).fetchone()[0]
        rows=[dict(x) for x in db.execute("SELECT i.id,i.number,i.invoice_date,i.due_date,i.status,i.taxable,i.cgst,i.sgst,i.total,i.historical,i.version,json_extract(i.customer_snapshot,'$.name') AS customer_name,(SELECT coalesce(sum(amount),0) FROM payments p WHERE p.invoice_id=i.id AND p.voided=0) AS paid FROM invoices i WHERE "+condition+" ORDER BY i.invoice_date DESC,i.created_at DESC LIMIT ? OFFSET ?",[*params,page_size,(page-1)*page_size])]
    for row in rows:
        row["balance"]=0 if row["status"] in {"Draft","Cancelled"} else row["total"]-row["paid"]
    return {"rows":rows,"total":count,"page":page,"page_size":page_size}


def refresh_payment_status(db,invoice_id):
    invoice=require_row(db,"invoices",invoice_id)
    paid=db.execute("SELECT coalesce(sum(amount),0) FROM payments WHERE invoice_id=? AND voided=0",(invoice_id,)).fetchone()[0]
    status="Paid" if paid>=invoice["total"] else "Partially Paid" if paid else "Unpaid"
    db.execute("UPDATE invoices SET status=?,version=version+1,updated_at=? WHERE id=?",(status,now(),invoice_id))


def save_payment(payload,actor,identifier=None):
    data=payload.model_dump()
    amount=paise(data["amount"])
    if amount<=0 or data["method"] not in {"Cash","UPI","Bank Transfer","Cheque","Other"}:
        raise BillingError("Enter a positive payment and a valid payment method")
    valid_date(data["payment_date"],"payment date")
    with connection(True) as db:
        old=require_row(db,"payments",identifier) if identifier else None
        if old and (old["invoice_id"]!=data["invoice_id"] or old["voided"]):
            raise BillingError("Cannot change this payment's invoice or edit a voided payment")
        duplicate=db.execute("SELECT invoice_id FROM payments WHERE id=?",(data["idempotency_key"],)).fetchone() if not identifier else None
        if duplicate:
            if duplicate[0]!=data["invoice_id"]:
                raise BillingError("Payment identifier is already used")
            return invoice_dict(db,duplicate[0])
        invoice=require_row(db,"invoices",data["invoice_id"])
        if invoice["status"] in {"Draft","Cancelled"}:
            raise BillingError("Payments require a finalized invoice")
        if data["payment_date"]<invoice["invoice_date"]:
            raise BillingError("Payment date cannot precede invoice date")
        paid=db.execute("SELECT coalesce(sum(amount),0) FROM payments WHERE invoice_id=? AND voided=0",(invoice["id"],)).fetchone()[0]
        if paid-(old["amount"] if old else 0)+amount>invoice["total"]:
            raise BillingError("Payment exceeds the invoice balance")
        values={k:data[k] for k in ["invoice_id","payment_date","method","reference","notes"]}
        values.update(amount=amount,updated_at=now())
        if old:
            db.execute("UPDATE payments SET "+",".join(k+"=?" for k in values)+" WHERE id=?",[*values.values(),identifier])
        else:
            identifier=data["idempotency_key"]
            values={"id":identifier,**values,"created_at":now()}
            db.execute("INSERT INTO payments ("+",".join(values)+") VALUES("+",".join("?" for _ in values)+")",list(values.values()))
        refresh_payment_status(db,invoice["id"])
        audit(db,actor,"Payment edited" if old else "Payment added",identifier,{"invoice_id":invoice["id"],"amount":amount})
        return invoice_dict(db,invoice["id"])


def cancel_invoice(identifier,reason,actor):
    with connection(True) as db:
        invoice=invoice_dict(db,identifier)
        if invoice["status"]=="Cancelled":
            return invoice
        if invoice["paid"]:
            raise BillingError("Void the invoice's payments with a reason before cancelling")
        db.execute("UPDATE invoices SET status='Cancelled',version=version+1,updated_at=? WHERE id=?",(now(),identifier))
        audit(db,actor,"Invoice cancelled",identifier,{"reason":reason,"number":invoice["number"]})
        return invoice_dict(db,identifier)


def void_payment(identifier,reason,actor):
    with connection(True) as db:
        payment=require_row(db,"payments",identifier)
        db.execute("UPDATE payments SET voided=1,updated_at=? WHERE id=?",(now(),identifier))
        refresh_payment_status(db,payment["invoice_id"])
        audit(db,actor,"Payment voided",identifier,{"reason":reason})
        return invoice_dict(db,payment["invoice_id"])


def report(kind,start,end):
    start=valid_date(start or today()[:7]+"-01");end=valid_date(end or today())
    if start>end:
        raise BillingError("Start date must be before end date")
    with connection() as db:
        base=" FROM invoices i WHERE status NOT IN ('Draft','Cancelled') AND invoice_date BETWEEN ? AND ?"
        aggregates="count(*) AS invoices,coalesce(sum(taxable),0) AS taxable,coalesce(sum(cgst),0) AS cgst,coalesce(sum(sgst),0) AS sgst,coalesce(sum(rounding),0) AS rounding,coalesce(sum(total),0) AS total,coalesce(sum(historical),0) AS historical_invoices"
        summary=dict(db.execute("SELECT "+aggregates+base,(start,end)).fetchone())
        if kind=="customers":
            # Cloud databases cannot call application-defined SQLite functions.
            # Keep the original name/place grouping for unlinked legacy records.
            grouped = {}
            for invoice in db.execute("SELECT customer_id,customer_snapshot,taxable,cgst,sgst,rounding,total,historical"+base+" ORDER BY id", (start,end)):
                customer = json.loads(invoice["customer_snapshot"])
                key = invoice["customer_id"] or normalized_name(customer.get("name"))+":"+str(customer.get("place") or "")
                row = grouped.setdefault(key, {"label":customer.get("name", ""), "invoices":0, "taxable":0, "cgst":0, "sgst":0, "rounding":0, "total":0, "historical_invoices":0})
                row["invoices"] += 1
                for field in ("taxable", "cgst", "sgst", "rounding", "total"):
                    row[field] += invoice[field]
                row["historical_invoices"] += invoice["historical"]
            rows = [grouped[key] for key in sorted(grouped)]
        elif kind in {"daily","monthly","gst"}:
            key="invoice_date" if kind=="daily" else "substr(invoice_date,1,7)"
            rows=[dict(x) for x in db.execute("SELECT "+key+" AS label,"+aggregates+base+" GROUP BY "+key+" ORDER BY "+key,(start,end))]
        elif kind=="outstanding":
            rows=[dict(x) for x in db.execute("SELECT id,number,invoice_date AS date,due_date,json_extract(customer_snapshot,'$.name') AS customer,total,(SELECT coalesce(sum(amount),0) FROM payments WHERE invoice_id=i.id AND voided=0) AS paid"+base+" AND status!='Paid' ORDER BY invoice_date",(start,end))]
            for r in rows:
                r["balance"]=r["total"]-r["paid"]
        elif kind=="sales":
            rows=[dict(x) for x in db.execute("SELECT id,number,invoice_date AS date,json_extract(customer_snapshot,'$.name') AS customer,json_extract(customer_snapshot,'$.gstin') AS gstin,taxable,cgst,sgst,rounding,total,status,historical"+base+" ORDER BY invoice_date,number",(start,end))]
        else:
            raise BillingError("Unknown report")
    return {"kind":kind,"start":start,"end":end,"summary":summary,"rows":rows}
