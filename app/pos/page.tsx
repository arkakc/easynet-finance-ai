"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";

interface PosProduct {
  id: string;
  name: string;
  category: string;
  sku: string;
  price: number;
}

interface CartItem extends PosProduct {
  quantity: number;
}

const DEFAULT_PRODUCTS: PosProduct[] = [
  { id: "1", name: "Heavy Duty Grease (500g)", category: "Hardware", sku: "HD-GRS-500", price: 45.0 },
  { id: "2", name: "Safety Helmet - High Vis Orange", category: "Safety", sku: "PPE-HLM-OR", price: 65.5 },
  { id: "3", name: "Steel Toe Work Boots (Size 10)", category: "Safety", sku: "PPE-BTS-10", price: 185.0 },
  { id: "4", name: "CAT Fuel Filter Element", category: "Parts", sku: "FLT-CAT-101", price: 120.0 },
  { id: "5", name: "Engine Oil 15W-40 (5 Litres)", category: "Fluids", sku: "OIL-15W40-5L", price: 95.0 },
  { id: "6", name: "Cotton Rags Bale (10kg)", category: "Supplies", sku: "RAG-10KG", price: 55.0 },
  { id: "7", name: "Heavy Duty LED Torch (Rechargeable)", category: "Tools", sku: "TLS-TRC-LED", price: 80.0 },
  { id: "8", name: "Industrial Measuring Tape (8m)", category: "Tools", sku: "TLS-MTP-8M", price: 35.0 },
  { id: "9", name: "First Aid Kit (Industrial 25-Person)", category: "Safety", sku: "PPE-FAK-25", price: 140.0 },
  { id: "10", name: "Safety Glasses Clear (Anti-Fog)", category: "Safety", sku: "PPE-GLS-CLR", price: 25.0 },
];

const CATEGORIES = ["ALL", "Safety", "Hardware", "Parts", "Fluids", "Tools", "Supplies"];

export default function PosTerminalPage() {
  const [cart, setCart] = useState<CartItem[]>([
    { ...DEFAULT_PRODUCTS[0], quantity: 2 },
    { ...DEFAULT_PRODUCTS[1], quantity: 1 },
  ]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "EFTPOS">("CASH");
  const [cashTendered, setCashTendered] = useState<number>(200);
  const [receiptSuccess, setReceiptSuccess] = useState(false);

  const filteredProducts = useMemo(() => {
    return DEFAULT_PRODUCTS.filter((p) => {
      const matchText =
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.sku.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCat = selectedCategory === "ALL" || p.category === selectedCategory;
      return matchText && matchCat;
    });
  }, [searchTerm, selectedCategory]);

  const addToCart = (product: PosProduct) => {
    const existing = cart.find((i) => i.id === product.id);
    if (existing) {
      setCart(cart.map((i) => (i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)));
    } else {
      setCart([...cart, { ...product, quantity: 1 }]);
    }
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(
      cart
        .map((item) => {
          if (item.id === id) {
            const next = item.quantity + delta;
            return next > 0 ? { ...item, quantity: next } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeFromCart = (id: string) => {
    setCart(cart.filter((i) => i.id !== id));
  };

  const clearCart = () => {
    setCart([]);
  };

  // Calculations
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const gstTax = subtotal * 0.1; // 10% IRC GST
  const grandTotal = subtotal + gstTax;
  const changeDue = Math.max(0, cashTendered - grandTotal);

  const handleCheckout = () => {
    if (cart.length === 0) return;
    setCashTendered(Math.ceil(grandTotal));
    setPaymentModalOpen(true);
  };

  const handleCompleteSale = () => {
    setReceiptSuccess(true);
    setTimeout(() => {
      setReceiptSuccess(false);
      setPaymentModalOpen(false);
      setCart([]);
    }, 1800);
  };

  return (
    <div>
      {/* PAGE HEADING */}
      <div className="page-head">
        <div>
          <h2>Retail POS Counter Terminal</h2>
          <p className="small">
            Fast counter checkout · Real-time IRC 10% GST calculation · Instant GL posting
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="badge">Base Currency: PGK (K)</span>
          <span className="auto-badge">Terminal #01 · Port Moresby</span>
        </div>
      </div>

      {/* CATEGORY TABS & SEARCH */}
      <div className="panel" style={{ marginTop: 0, paddingBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div className="tabs" style={{ marginTop: 0 }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`tab ${selectedCategory === cat ? "active" : ""}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          <div style={{ width: 280 }}>
            <input
              type="text"
              placeholder="Search product or SKU…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* MAIN LAYOUT: CATALOG + CART */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 20, marginTop: 20 }}>
        {/* PRODUCT CATALOG */}
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
            {filteredProducts.map((p) => (
              <div
                key={p.id}
                className="card"
                onClick={() => addToCart(p)}
                style={{
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  transition: "transform 0.1s ease, box-shadow 0.1s ease",
                  border: "1px solid #dde5ee",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: "#607086", textTransform: "uppercase", fontWeight: 700 }}>
                      {p.category}
                    </span>
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>{p.sku}</span>
                  </div>
                  <strong style={{ fontSize: 13, display: "block", color: "#10253f" }}>{p.name}</strong>
                </div>

                <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: "#123d68" }}>
                    {formatCurrency(p.price)}
                  </span>
                  <button
                    type="button"
                    style={{ padding: "4px 10px", fontSize: 12 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      addToCart(p);
                    }}
                  >
                    + Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CART & BILLING PANEL */}
        <div>
          <div className="panel" style={{ marginTop: 0, position: "sticky", top: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>Current Order ({cart.reduce((s, i) => s + i.quantity, 0)} items)</h3>
              {cart.length > 0 && (
                <button
                  type="button"
                  className="secondary"
                  onClick={clearCart}
                  style={{ padding: "4px 10px", fontSize: 11, color: "#b91c1c" }}
                >
                  Clear Cart
                </button>
              )}
            </div>

            {cart.length === 0 ? (
              <div style={{ padding: "30px 10px", textAlign: "center", color: "#607086" }}>
                <p>Cart is currently empty.</p>
                <p className="small">Click products on the left to add items to this counter sale.</p>
              </div>
            ) : (
              <>
                <div style={{ maxHeight: 320, overflowY: "auto", borderBottom: "1px solid #e5ebf2", paddingBottom: 10 }}>
                  <table className="data-table" style={{ minWidth: 0 }}>
                    <tbody>
                      {cart.map((item) => (
                        <tr key={item.id}>
                          <td style={{ padding: "8px 4px" }}>
                            <strong style={{ fontSize: 13, display: "block" }}>{item.name}</strong>
                            <span className="small">{formatCurrency(item.price)} each</span>
                          </td>
                          <td style={{ padding: "8px 4px", whiteSpace: "nowrap" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => updateQuantity(item.id, -1)}
                                style={{ padding: "2px 8px", fontSize: 11 }}
                              >
                                -
                              </button>
                              <span style={{ fontWeight: 700, minWidth: 20, textAlign: "center" }}>
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => updateQuantity(item.id, 1)}
                                style={{ padding: "2px 8px", fontSize: 11 }}
                              >
                                +
                              </button>
                            </div>
                          </td>
                          <td style={{ padding: "8px 4px", textAlign: "right", fontWeight: 700 }}>
                            {formatCurrency(item.price * item.quantity)}
                          </td>
                          <td style={{ padding: "8px 2px", textAlign: "center" }}>
                            <button
                              type="button"
                              onClick={() => removeFromCart(item.id)}
                              style={{ background: "transparent", border: 0, color: "#ef4444", cursor: "pointer", padding: 2 }}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* TOTALS */}
                <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span className="small">Subtotal (Net):</span>
                    <span>{formatCurrency(subtotal)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span className="small">IRC GST (10%):</span>
                    <span>{formatCurrency(gstTax)}</span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 18,
                      fontWeight: 700,
                      color: "#123d68",
                      borderTop: "2px solid #dde5ee",
                      paddingTop: 10,
                      marginTop: 4,
                    }}
                  >
                    <span>Total Due:</span>
                    <span>{formatCurrency(grandTotal)}</span>
                  </div>
                </div>

                {/* CHECKOUT BUTTON */}
                <button
                  type="button"
                  onClick={handleCheckout}
                  style={{
                    width: "100%",
                    marginTop: 18,
                    padding: "12px",
                    fontSize: 15,
                    fontWeight: 700,
                    background: "#16a34a",
                  }}
                >
                  Pay & Issue Receipt ({formatCurrency(grandTotal)})
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* PAYMENT MODAL */}
      {paymentModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(16, 37, 63, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
        >
          <div
            className="panel"
            style={{
              width: 440,
              background: "white",
              padding: 24,
              borderRadius: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
            }}
          >
            {receiptSuccess ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: 40, color: "#16a34a", marginBottom: 10 }}>✓</div>
                <h3 style={{ margin: 0, color: "#16a34a" }}>Sale Completed!</h3>
                <p className="small" style={{ marginTop: 6 }}>
                  Receipt printed · Posted to GL & Cash Register
                </p>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                  <h3 style={{ margin: 0 }}>Tender & Settlement</h3>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setPaymentModalOpen(false)}
                    style={{ padding: "2px 8px" }}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ background: "#f8fafc", padding: 14, borderRadius: 8, marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span className="small">Total Due:</span>
                    <strong style={{ fontSize: 18, color: "#123d68" }}>{formatCurrency(grandTotal)}</strong>
                  </div>
                </div>

                {/* PAYMENT METHOD TABS */}
                <div className="tabs" style={{ marginTop: 0, marginBottom: 16 }}>
                  <button
                    type="button"
                    className={`tab ${paymentMethod === "CASH" ? "active" : ""}`}
                    onClick={() => setPaymentMethod("CASH")}
                    style={{ flex: 1 }}
                  >
                    Cash Tender
                  </button>
                  <button
                    type="button"
                    className={`tab ${paymentMethod === "EFTPOS" ? "active" : ""}`}
                    onClick={() => setPaymentMethod("EFTPOS")}
                    style={{ flex: 1 }}
                  >
                    BSP EFTPOS
                  </button>
                </div>

                {paymentMethod === "CASH" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <label>
                      <span className="small" style={{ fontWeight: 600 }}>
                        Cash Tendered (K):
                      </span>
                      <input
                        type="number"
                        step="1"
                        value={cashTendered}
                        onChange={(e) => setCashTendered(parseFloat(e.target.value) || 0)}
                        style={{ fontSize: 18, fontWeight: 700 }}
                      />
                    </label>

                    <div style={{ display: "flex", gap: 6 }}>
                      {[20, 50, 100, 200].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          className="secondary"
                          onClick={() => setCashTendered(amt)}
                          style={{ flex: 1, padding: "6px 0", fontSize: 12 }}
                        >
                          K{amt}
                        </button>
                      ))}
                    </div>

                    <div
                      style={{
                        background: changeDue >= 0 ? "#eaf8ef" : "#fef2f2",
                        padding: 12,
                        borderRadius: 8,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span style={{ fontWeight: 600, color: changeDue >= 0 ? "#17643a" : "#991b1b" }}>
                        Change Due:
                      </span>
                      <strong style={{ fontSize: 18, color: changeDue >= 0 ? "#17643a" : "#991b1b" }}>
                        {formatCurrency(changeDue)}
                      </strong>
                    </div>
                  </div>
                ) : (
                  <div style={{ background: "#f8fafc", padding: 14, borderRadius: 8, textAlign: "center" }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>Bank South Pacific (BSP) Card Terminal</p>
                    <p className="small" style={{ margin: "4px 0 0" }}>
                      Tap, insert, or swipe card on terminal for {formatCurrency(grandTotal)}.
                    </p>
                  </div>
                )}

                <div className="button-row" style={{ marginTop: 20 }}>
                  <button
                    type="button"
                    onClick={handleCompleteSale}
                    disabled={paymentMethod === "CASH" && cashTendered < grandTotal}
                    style={{ flex: 1, padding: "12px", background: "#16a34a" }}
                  >
                    Complete Transaction
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setPaymentModalOpen(false)}
                    style={{ padding: "12px 18px" }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
