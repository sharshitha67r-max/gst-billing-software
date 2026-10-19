from io import BytesIO
from xml.sax.saxutils import escape
from base64 import b64decode
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_RIGHT, TA_CENTER
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, Image
from .money import amount_words


def money(n):
    return f"{n/100:,.2f}"


def invoice_pdf(invoice):
    buf=BytesIO()
    doc=SimpleDocTemplate(buf,pagesize=A4,rightMargin=32,leftMargin=32,topMargin=28,bottomMargin=32,title=f"Invoice {invoice['number'] or 'Draft'}",author="SVS Billing")
    styles=getSampleStyleSheet()
    normal=ParagraphStyle("InvoiceNormal",parent=styles["Normal"],fontName="Helvetica",fontSize=9,leading=12,spaceAfter=0)
    small=ParagraphStyle("InvoiceSmall",parent=normal,fontSize=8,leading=10)
    title=ParagraphStyle("InvoiceTitle",parent=normal,fontSize=16,leading=20,alignment=TA_CENTER,fontName="Helvetica-Bold")
    def p(text,style=normal):
        return Paragraph(escape(str(text)).replace("\n","<br/>"),style)
    b=invoice["business_snapshot"];c=invoice["customer_snapshot"]
    elements=[p("DRAFT INVOICE" if invoice["status"]=="Draft" else "CANCELLED TAX INVOICE" if invoice["status"]=="Cancelled" else "TAX INVOICE",title),Spacer(1,12)]
    left=[p(b["business_name"],styles["Heading2"]),p(b["address"])]
    if b.get("show_gstin",True) and b.get("gstin"):
        left.append(p("GSTIN: "+b["gstin"]))
    if b.get("show_phone",True) and b.get("phone"):
        left.append(p("Phone: "+b["phone"]))
    if b.get("email"):
        left.append(p(b["email"]))
    if b.get("logo"):
        try:
            image=Image(BytesIO(b64decode(b["logo"].split(",",1)[1])))
            image._restrictSize(100,42)
            left.insert(0,image)
        except Exception:
            pass
    header=Table([[left,[p("INVOICE NO: "+str(invoice["number"] or "Draft")),p("DATE: "+invoice["invoice_date"]),p("STATUS: "+invoice["status"])]]],colWidths=[350,169])
    header.setStyle(TableStyle([("BOX",(0,0),(-1,-1),.8,colors.black),("VALIGN",(0,0),(-1,-1),"TOP"),("LINEBEFORE",(1,0),(1,0),.5,colors.black),("TOPPADDING",(0,0),(-1,-1),10),("BOTTOMPADDING",(0,0),(-1,-1),10)]))
    elements.append(header)
    customer_address="\n".join(filter(None,[c.get("place"),", ".join(filter(None,[c.get("city"),c.get("state"),c.get("pincode")]))]))
    customer=[p("To, M/S "+c.get("name","")),p(customer_address)]
    if b.get("show_phone",True) and c.get("phone"):
        customer.append(p("Phone: "+c["phone"]))
    if b.get("show_gstin",True) and c.get("gstin"):
        customer.append(p("GSTIN: "+c["gstin"]))
    cust=Table([[customer]],colWidths=[519]);cust.setStyle(TableStyle([("BOX",(0,0),(-1,-1),.8,colors.black),("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]));elements.extend([cust,Spacer(1,10)])
    hsn=b.get("show_hsn",False);taxable=b.get("show_taxable",True)
    headings=["Sl.","Description of goods"]+(["HSN"] if hsn else [])+["Qty","Rate (Rs.)","Amount (Rs.)"]+(["Discount" if b.get("legacy_labels") else "Taxable value"] if taxable else [])
    widths=[24,519-24-44-63-76-(88 if taxable else 0)-(42 if hsn else 0)]+([42] if hsn else [])+[44,63,76]+([88] if taxable else [])
    rows=[[p(x,small) for x in headings]]
    for n,line in enumerate(invoice["lines"],1):
        description=line["description"]
        if line.get("discount",0):
            description+=f"\nDiscount {line['discount_percent']}%: Rs. {money(line['discount'])}"
        rows.append([str(n),p(description,small)]+([p(line.get("hsn",""),small)] if hsn else [])+[str(line["quantity"]),money(line["unit_price"]),money(line["amount"])]+([money(line["taxable"])] if taxable else []))
    if len(rows)==1:
        rows.append(["",p("Historical total-only record; item details and tax breakdown were not supplied.",small)]+[""]*(len(headings)-2))
    table=Table(rows,colWidths=widths,repeatRows=1,hAlign="LEFT")
    table.setStyle(TableStyle([("GRID",(0,0),(-1,-1),.5,colors.black),("BACKGROUND",(0,0),(-1,0),colors.HexColor("#f0f0f0")),("VALIGN",(0,0),(-1,-1),"TOP"),("FONTNAME",(0,0),(-1,-1),"Helvetica"),("FONTSIZE",(0,0),(-1,-1),8),("ALIGN",(2,1),(-1,-1),"RIGHT"),("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6)]))
    elements.append(table)
    summary=[]
    if not invoice["historical"]:
        summary.append(["Taxable total",money(invoice["taxable"])])
        for group in invoice["tax_groups"]:
            half=float(group["gst_rate"])/2
            summary.extend([[f"CGST {half:g}%",money(group["cgst"])],[f"SGST {half:g}%",money(group["sgst"])]])
        if invoice["rounding"]:
            summary.append(["Rounding adjustment",money(invoice["rounding"])])
    summary.append(["GRAND TOTAL (Rs.)",money(invoice["total"])])
    if invoice["paid"]:
        summary.extend([["Amount paid",money(invoice["paid"])],["Balance due",money(invoice["balance"])]])
    totals=Table(summary,colWidths=[200,100],hAlign="RIGHT")
    totals.setStyle(TableStyle([("ALIGN",(1,0),(1,-1),"RIGHT"),("FONTNAME",(0,0),(-1,-1),"Helvetica"),("FONTSIZE",(0,0),(-1,-1),9),("LINEABOVE",(0,0),(-1,0),.6,colors.black),("TOPPADDING",(0,0),(-1,-1),6),("FONTNAME",(0,len(summary)-1),(-1,-1),"Helvetica-Bold")]))
    elements.append(KeepTogether([Spacer(1,10),totals,Spacer(1,10),p(amount_words(invoice["total"])),Spacer(1,10)]))
    bottom=[p("Terms: "+(invoice["terms"] or b.get("terms","")),small),Spacer(1,8),p(b.get("declaration",""),small)]
    if b.get("bank_details") or b.get("upi"):
        bottom.extend([Spacer(1,8),p("\n".join(filter(None,[b.get("bank_details"),"UPI: "+b["upi"] if b.get("upi") else ""])),small)])
    signatures=Table([[p(b.get("receiver_label","Receiver Signature") if b.get("show_receiver",True) else "",small),p("For "+b["business_name"]+"\n\n\n"+b.get("signatory","Authorised Signatory") if b.get("show_signatory",True) else "",small)]],colWidths=[259,260])
    signatures.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"BOTTOM"),("ALIGN",(1,0),(1,0),"RIGHT"),("TOPPADDING",(0,0),(-1,-1),20)]))
    bottom.extend([signatures,Spacer(1,10),p(b.get("footer",""),small)])
    elements.append(KeepTogether(bottom))
    def page(canvas,doc):
        canvas.setFont("Helvetica",7);canvas.drawRightString(A4[0]-32,18,f"Page {doc.page}")
    doc.build(elements,onFirstPage=page,onLaterPages=page)
    return buf.getvalue()


def report_pdf(data,business):
    buf=BytesIO();doc=SimpleDocTemplate(buf,pagesize=landscape(A4),leftMargin=25,rightMargin=25,topMargin=25,bottomMargin=25)
    styles=getSampleStyleSheet();small=ParagraphStyle("Report",parent=styles["Normal"],fontSize=7,leading=9)
    keys=[k for k in (list(data["rows"][0]) if data["rows"] else ["label","total"]) if k not in {"id"}]
    money_keys={"taxable","cgst","sgst","rounding","total","paid","balance"}
    rows=[[Paragraph(escape(k.replace("_"," ").title()),small) for k in keys]]
    for row in data["rows"]:
        rows.append([Paragraph(escape("Unavailable" if row.get("historical") and k in {"taxable","cgst","sgst","rounding"} else money(row[k]) if k in money_keys else str(row[k] or "")),small) for k in keys])
    if len(rows)==1:
        rows.append(["No records"]+[""]*(len(keys)-1))
    t=Table(rows,colWidths=[(landscape(A4)[0]-50)/len(keys)]*len(keys),repeatRows=1)
    t.setStyle(TableStyle([("GRID",(0,0),(-1,-1),.25,colors.grey),("VALIGN",(0,0),(-1,-1),"TOP"),("BACKGROUND",(0,0),(-1,0),colors.HexColor("#eeeeee")),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
    doc.build([Paragraph(escape(business["business_name"]),styles["Heading1"]),Paragraph(escape(data["kind"].title()+" report | "+data["start"]+" to "+data["end"]),styles["Normal"]),Spacer(1,12),t])
    return buf.getvalue()
