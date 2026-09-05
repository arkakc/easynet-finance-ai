"use client";

export default function PrintButton() {
  return <button type="button" className="print-button no-print" onClick={() => window.print()}>Print / Save PDF</button>;
}
