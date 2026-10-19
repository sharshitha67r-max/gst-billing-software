"""GST-inclusive calculations. Decimal in, integer paise out; no binary floats."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from collections import defaultdict


class BillingError(ValueError):
    pass


def decimal(value, label="value", minimum=Decimal("0"), maximum=Decimal("1000000000")):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise BillingError(f"Invalid {label}")
    if not result.is_finite() or not minimum <= result <= maximum:
        raise BillingError(f"{label} must be between {minimum} and {maximum}")
    return result


def paise(value):
    return int((decimal(value, "amount") * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def rounded(value):
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def calculate(lines, discounts_enabled=False):
    if not 1 <= len(lines) <= 500:
        raise BillingError("An invoice must contain between 1 and 500 items")
    result, groups = [], defaultdict(int)
    for line in lines:
        description = str(line.get("description", "")).strip()
        if not description or len(description) > 500:
            raise BillingError("Each item needs a description of at most 500 characters")
        qty = decimal(line.get("quantity", 1), "quantity", Decimal("0.001"), Decimal("1000000"))
        if qty.as_tuple().exponent < -3:
            raise BillingError("Quantity supports up to three decimal places")
        unit_price = paise(line.get("rate", 0))
        gst = decimal(line.get("gst_rate", 18), "GST rate", maximum=Decimal("100"))
        if gst.as_tuple().exponent < -2:
            raise BillingError("GST rate supports up to two decimal places")
        discount = decimal(line.get("discount_percent", 0), "discount", maximum=Decimal("100"))
        if discount and not discounts_enabled:
            raise BillingError("Enable real discounts in Settings before applying a discount")
        before = rounded(qty * unit_price)
        gross = rounded(qty * unit_price * (100-discount) / 100)
        taxable = rounded(Decimal(gross) * 100 / (100+gst))
        groups[str(gst)] += taxable
        result.append({"item_id": line.get("item_id"), "description": description,
                       "hsn": str(line.get("hsn", ""))[:30], "unit": str(line.get("unit", "Nos"))[:30],
                       "quantity": str(qty), "unit_price": unit_price, "gst_rate": str(gst),
                       "discount_percent": str(discount), "discount": before-gross,
                       "amount": gross, "taxable": taxable})
    tax_groups = [{"gst_rate": rate, "taxable": base,
                   "cgst": rounded(Decimal(base)*Decimal(rate)/200),
                   "sgst": rounded(Decimal(base)*Decimal(rate)/200)} for rate, base in groups.items()]
    totals = {"taxable": sum(x["taxable"] for x in result),
              "cgst": sum(x["cgst"] for x in tax_groups), "sgst": sum(x["sgst"] for x in tax_groups),
              "total": sum(x["amount"] for x in result), "discount": sum(x["discount"] for x in result)}
    totals["rounding"] = totals["total"] - totals["taxable"] - totals["cgst"] - totals["sgst"]
    if totals["total"] > 100000000000:
        raise BillingError("Invoice exceeds the supported total")
    return {"lines": result, "tax_groups": tax_groups, **totals}


ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def number_words(n):
    if n == 0:
        return "Zero"
    if n < 20:
        return ONES[n]
    if n < 100:
        return (TENS[n//10] + " " + ONES[n%10]).strip()
    for base, label in [(10000000, "Crore"), (100000, "Lakh"), (1000, "Thousand"), (100, "Hundred")]:
        if n >= base:
            return number_words(n//base) + " " + label + (" " + number_words(n%base) if n%base else "")


def amount_words(value):
    rupees, coins = divmod(value, 100)
    return "Rupees " + number_words(rupees) + (" and " + number_words(coins) + " Paise" if coins else "") + " Only"
