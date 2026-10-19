"""Review-first Excel/CSV imports; customer data never belongs in the Git repo."""
import csv
import io
import json
import re
import time
import uuid
import zipfile
from datetime import datetime, date
from openpyxl import load_workbook, Workbook
from openpyxl.utils.datetime import from_excel
from .database import connection, now, settings, audit
from .models import Customer, Item
from .money import BillingError, paise
from .service import save_master, valid_date

ALIASES={
    "name":{"name","customername","customer","partyname","itemname","item","product","productname","description","descriptionofgoods"},
    "place":{"place","address","customeraddress","customerdetails","placeaddress","details"},
    "city":{"city","town"},"state":{"state"},"pincode":{"pincode","pin","zipcode","postalcode"},
    "phone":{"phone","phonenumber","mobile","mobilenumber","contact"},"gstin":{"gstin","gst","gstnumber","gstno"},
    "email":{"email","emailaddress"},"notes":{"notes","note"},
    "default_rate":{"defaultsellingrate","default_rate","defaultrate","sellingrate","rate","price"},
    "gst_rate":{"gstrate","gstpercent","gstpercentage"},"unit":{"unit","uom"},"hsn":{"hsn","hsnsac","hsncode"},
    "number":{"slno","sno","invoicenumber","invoiceno","billno","billnumber","invoice"},
    "invoice_date":{"date","invoicedate","billdate"},"amount":{"amount","total","grandtotal","invoiceamount"},
}


def norm(value):
    return re.sub(r"[^a-z0-9]","",str(value or "").lower())


def text(value):
    if value is None or str(value).strip().startswith(("#N/A","#REF!","#VALUE!","#DIV/0!")):
        return ""
    if isinstance(value,float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def parse_date(value):
    if isinstance(value,(datetime,date)):
        return value.date().isoformat() if isinstance(value,datetime) else value.isoformat()
    if isinstance(value,(int,float)):
        return from_excel(value).date().isoformat()
    value=text(value)
    for fmt in ["%Y-%m-%d","%d/%m/%Y","%d-%m-%Y","%d.%m.%Y","%m/%d/%Y","%d/%m/%y"]:
        try:
            return datetime.strptime(value,fmt).date().isoformat()
        except ValueError:
            pass
    raise BillingError("Missing or unrecognized date")


def read_rows(blob,filename,kind):
    if filename.lower().endswith(".csv"):
        try:
            return list(csv.reader(io.StringIO(blob.decode("utf-8-sig"))))[:50001],"CSV",False
        except UnicodeError:
            raise BillingError("Save CSV as UTF-8 or upload an .xlsx workbook")
    if not filename.lower().endswith(".xlsx"):
        raise BillingError("Use an .xlsx workbook or UTF-8 .csv file")
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            if sum(i.file_size for i in z.infolist())>512*1024*1024 or len(z.infolist())>2000:
                raise BillingError("Workbook is too large when expanded")
        wb=load_workbook(io.BytesIO(blob),read_only=True,data_only=True,keep_links=False)
        desired={"customers":{"customer","customers","customermaster"},"items":{"item","items","products","product"},"orders":{"orders","order","invoices","sales","salesregister"}}[kind]
        name=next((s for s in wb.sheetnames if norm(s) in desired),wb.sheetnames[0] if len(wb.sheetnames)==1 else None)
        if not name:
            raise BillingError("No matching sheet found. Expected Customer, Item or Orders")
        ws=wb[name]
        rows=[];blank_run=0;truncated=False
        # Legacy workbooks have a million formula-only rows. Stop a blank tail early.
        for row in ws.iter_rows(max_col=30,max_row=min(ws.max_row or 50000,50000),values_only=True):
            row=list(row)
            if all(not text(c) for c in row):
                blank_run+=1
            else:
                blank_run=0
            rows.append(row)
            if blank_run>=300:
                truncated=(ws.max_row or 0)>len(rows)
                break
        if (ws.max_row or 0)>50000:
            truncated=True
        wb.close()
        return rows,name,truncated
    except BillingError:
        raise
    except Exception:
        raise BillingError("Could not read this workbook. Upload a valid, unencrypted .xlsx file")


def preview_import(blob,filename,kind):
    if kind not in {"customers","items","orders"}:
        raise BillingError("Choose customers, items or historical orders")
    rows,sheet,truncated=read_rows(blob,filename,kind)
    aliases={alias:key for key,values in ALIASES.items() for alias in values}
    best=None
    candidates=list(enumerate(rows[:20]))
    if kind=="items":
        # An "Item Name" cell inside the product list is a suspicious record,
        # not a header that should discard all preceding descriptions.
        candidates=next(([pair] for pair in candidates if any(text(v) for v in pair[1])),[])
    for index,row in candidates:
        mapping={aliases[norm(value)]:col for col,value in enumerate(row) if norm(value) in aliases}
        required={"name"} if kind!="orders" else {"name","invoice_date","amount"}
        if required<=mapping.keys():
            score=len(mapping)
            if best is None or score>best[0]:
                best=(score,index,mapping)
    if best:
        _,header,mapping=best
        source=rows[header+1:];offset=header+2
    elif kind=="items":
        mapping={"name":next((i for i,v in enumerate(rows[0] if rows else []) if isinstance(v,str) and text(v)),0)}
        source=rows;offset=1
    else:
        raise BillingError("Could not find the sheet headers. Use the downloadable import template")
    records=[];skipped=0;incomplete=0;seen=set()
    with connection() as db:
        existing={norm(x[0]) for x in db.execute("SELECT name FROM "+("items" if kind=="items" else "customers"))}
        numbers={x[0] for x in db.execute("SELECT number FROM invoices WHERE number IS NOT NULL")}
    for index,row in enumerate(source,offset):
        raw={key:row[col] if col<len(row) else None for key,col in mapping.items()}
        values={key:text(value) for key,value in raw.items()}
        # Names alone filled by VLOOKUP without a date/amount are not orders.
        if kind=="orders" and not (values.get("invoice_date") or values.get("amount") or values.get("name")):
            skipped+=1;continue
        if not values.get("name") and not any(values.values()):
            skipped+=1;continue
        warnings=[];error="";data={}
        try:
            if kind=="customers":
                data=Customer(**{k:v for k,v in values.items() if k in Customer.model_fields}).model_dump()
                if norm(data["name"]) in existing or norm(data["name"]) in seen:
                    warnings.append("Possible duplicate name. Kept separate; select only after review")
            elif kind=="items":
                values["name"]=str(raw.get("name") or "")
                data=Item(**{k:(v if v!="" else None) for k,v in values.items() if k in Item.model_fields and (v!="" or k=="default_rate")}).model_dump()
                if norm(data["name"]) in {"itemname","description","descriptionofgoods","productname","name"}:
                    raise BillingError("Header-like description; review this row instead of importing")
                if norm(data["name"]) in existing or norm(data["name"]) in seen:
                    warnings.append("Possible duplicate item description")
                if data.get("default_rate") is not None:
                    paise(data["default_rate"])
                warnings.append("Rate is unset; numbers in descriptions were preserved") if data.get("default_rate") is None else None
            else:
                if not values.get("name") or not values.get("number"):
                    raise BillingError("Missing customer or invoice number")
                if values["number"] in numbers or values["number"] in seen:
                    raise BillingError("Invoice number already exists or is duplicated in this file")
                amount=paise(values.get("amount",""))
                if amount<=0:
                    raise BillingError("Missing or non-positive total")
                data={"number":values["number"],"name":values["name"],"place":values.get("place",""),"invoice_date":valid_date(parse_date(raw.get("invoice_date"))),"total":amount}
                warnings.append("Total-only historical record: tax breakdown unavailable; imported as Unpaid")
                numbers.add(data["number"])
            seen.add(data.get("number",norm(data.get("name",""))))
        except Exception as e:
            error=str(e) if isinstance(e,BillingError) else "Incomplete or invalid fields"
            incomplete+=1
        records.append({"index":len(records),"row":index,"data":data,"source":values,"warnings":warnings,"error":error,
                        "recommended":not error and not any("duplicate" in w.lower() for w in warnings) and kind!="orders"})
        if len(records)>=10000:
            truncated=True;break
    preview={"kind":kind,"sheet":sheet,"records":records,"valid":len(records)-incomplete,"incomplete":incomplete,"skipped":skipped,"truncated":truncated,
             "notice":"Only the first 50,000 rows are scanned; scanning stops after 300 consecutive empty/formula-only rows. Split data after large gaps into a separate file." if truncated else "Review all warnings before importing. Duplicates are never merged."}
    preview_id=str(uuid.uuid4())
    with connection(True) as db:
        db.execute("DELETE FROM import_previews WHERE created_at<?",(int(time.time())-3600,))
        db.execute("INSERT INTO import_previews VALUES(?,?,?)",(preview_id,json.dumps(preview),int(time.time())))
    return {"id":preview_id,**preview}


def commit_import(preview_id,selected,actor):
    with connection(True) as db:
        saved=db.execute("SELECT data FROM import_previews WHERE id=? AND created_at>?",(preview_id,int(time.time())-3600)).fetchone()
        if not saved:
            raise BillingError("Import preview expired or already imported. Upload the file again")
        preview=json.loads(saved[0]);count=0
        if not selected:
            raise BillingError("Select at least one valid row to import")
        business_snapshot = json.dumps(settings(db))
        customers_by_name = {}
        if preview["kind"]=="orders":
            for customer in db.execute("SELECT * FROM customers"):
                customers_by_name.setdefault(customer["name"].strip().lower(), []).append(dict(customer))
        for i in sorted(set(selected)):
            if i<0 or i>=len(preview["records"]):
                raise BillingError("Invalid selected row")
            record=preview["records"][i]
            if record["error"]:
                raise BillingError("Incomplete rows cannot be imported")
            data=record["data"]
            if preview["kind"] in {"customers","items"}:
                save_master(db,preview["kind"],data.copy(),actor,read_back=False)
            else:
                identifier=str(uuid.uuid4())
                # Only link an unambiguous existing master; never automatically merge names.
                matches=customers_by_name.get(data["name"].strip().lower(), [])
                customer=dict(matches[0]) if len(matches)==1 else {"name":data["name"],"place":data["place"]}
                values={"id":identifier,"number":data["number"],"invoice_date":data["invoice_date"],"customer_id":customer.get("id"),"customer_snapshot":json.dumps(customer),"business_snapshot":business_snapshot,"status":"Unpaid","taxable":0,"cgst":0,"sgst":0,"rounding":0,"total":data["total"],"terms":"","notes":"Historical total-only import. Tax and payment history were not supplied.","tax_groups":"[]","historical":1,"created_at":now(),"updated_at":now()}
                db.execute("INSERT INTO invoices ("+",".join(values)+") VALUES("+",".join("?" for _ in values)+")",list(values.values()))
            count+=1
        db.execute("DELETE FROM import_previews WHERE id=?",(preview_id,))
        audit(db,actor,"Excel import completed",details={"kind":preview["kind"],"count":count})
    return {"imported":count,"kind":preview["kind"]}


def safe_cell(value):
    # Prevent workbook formula injection from names/notes in exported business data.
    if isinstance(value,str) and value.startswith(("=","+","-","@","\t","\r")):
        return "'"+value
    return value


def workbook_bytes(headers,rows):
    wb=Workbook(write_only=True);ws=wb.create_sheet("SVS Export")
    ws.append(headers)
    for row in rows:
        ws.append([safe_cell(v) for v in row])
    output=io.BytesIO();wb.save(output)
    return output.getvalue()


def export_master(kind):
    with connection() as db:
        if kind=="customers":
            columns=["name","place","city","state","pincode","phone","gstin","email","notes","active"]
        elif kind=="items":
            columns=["name","description","default_rate","gst_rate","unit","hsn","active"]
        elif kind=="invoices":
            headers=["Invoice number","Date","Customer","GSTIN","Taxable","CGST","SGST","Rounding","Total","Status","Historical"]
            records=db.execute("SELECT number,invoice_date,json_extract(customer_snapshot,'$.name'),json_extract(customer_snapshot,'$.gstin'),taxable,cgst,sgst,rounding,total,status,historical FROM invoices ORDER BY invoice_date")
            return workbook_bytes(headers,([*list(row)[:4],*[int(v)/100 for v in list(row)[4:9]],*list(row)[9:]] for row in records))
        else:
            raise BillingError("Unknown export")
        records=db.execute("SELECT "+",".join(columns)+" FROM "+kind+" ORDER BY name")
        def values():
            for row in records:
                result=list(row)
                if kind=="items" and result[2] is not None:
                    result[2]/=100
                yield result
        headers=["Default Selling Rate" if c=="default_rate" else c.replace("_"," ").title() for c in columns]
        return workbook_bytes(headers,values())


def template(kind):
    columns={"customers":["Name","Place","City","State","Pincode","Phone","GSTIN","Email","Notes"],
             "items":["Name","Default Selling Rate","GST Rate","Unit","HSN"],
             "orders":["Invoice Number","Customer Name","Customer Details","Date","Amount"]}.get(kind)
    if not columns:
        raise BillingError("Unknown template")
    return workbook_bytes(columns,[])
