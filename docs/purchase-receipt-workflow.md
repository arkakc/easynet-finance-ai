# Purchase Receipt / Goods Receipt workflow

Purchase Receipt is allowed only against a valid approved Purchase Order lifecycle document. It has two entry points that use the same backend validation and valuation engine:

1. Purchase Order view -> Create Purchase Receipt / Goods Receipt.
2. Items & Stock -> New Stock Movement / Goods Receipt -> Purchase Receipt.

Rules:
- Supplier Quotations cannot be used as receipt sources.
- PO lines must be linked to Item Master.
- Only STOCK items can be received.
- Received quantity cannot exceed the remaining PO quantity.
- PO purchase rate is read-only in the receipt and is derived from the matching PO line(s).
- Item moving-average cost is recalculated after each receipt.
- Purchase Receipts use `PR-YYYY-*` movement IDs; other stock movements use `MOV-YYYY-*`.
- Item, PO, receipt/movement and valuation history remain clickable for traceability.

The stock screen loads independent backend datasets in parallel to reduce Apps Script round trips.
