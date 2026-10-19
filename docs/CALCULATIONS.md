# Invoice calculations

Prices are inclusive of GST. The server uses decimal arithmetic with `ROUND_HALF_UP`. Database amounts are integer paise; quantities are decimal strings supporting up to three decimal places. Rates are normalized to two decimal places.

For each line:

1. Gross amount is quantity × inclusive unit rate, less any explicitly enabled real discount, rounded to paise.
2. Taxable value is gross ÷ (1 + GST rate ÷ 100), rounded to paise.
3. Taxable values are grouped by GST rate.
4. CGST and SGST each equal the group's taxable value × GST rate ÷ 200, rounded independently to paise.
5. The invoice total remains the sum of the original gross line amounts. A visible rounding adjustment reconciles that total with the rounded taxable and tax amounts.

This preserves equal CGST and SGST while keeping the customer's GST-inclusive price unchanged. Floating-point values are used only for display/chart heights, never to validate final invoice amounts.

## Original six-line acceptance example

| Quantity | Inclusive rate | Gross | Taxable value |
| ---: | ---: | ---: | ---: |
| 50 | 77.00 | 3,850.00 | 3,262.71 |
| 80 | 77.00 | 6,160.00 | 5,220.34 |
| 20 | 77.00 | 1,540.00 | 1,305.08 |
| 14 | 190.00 | 2,660.00 | 2,254.24 |
| 192 | 12.50 | 2,400.00 | 2,033.90 |
| 25 | 49.00 | 1,225.00 | 1,038.14 |

Taxable total: **15,114.41**. CGST: **1,360.30**. SGST: **1,360.30**. Rounding adjustment: **−0.01**. Grand total: **17,835.00**.

The workbook kept additional hidden precision. Its independently displayed rounded taxable and equal tax amounts sum to 17,835.01. The explicit one-paisa adjustment reconciles the printed figures instead of silently changing the gross total.

## Historical records

An Orders row supplies a total, not a trustworthy item/tax breakdown or payment history. Imported historical records therefore:

- have no invented invoice lines or GST split;
- carry a visible historical flag;
- show unavailable tax fields as unavailable in the register exports;
- contribute their gross amount to sales and, when imported as Unpaid, to outstanding balances;
- cannot be edited as if they had complete line details;
- can receive payments and be cancelled through the ordinary audited workflow.

Tax reports aggregate known tax amounts only and identify historical-record counts. Drafts and cancelled invoices are excluded from sales and outstanding totals.
