/**
 * Purchase & Landed Cost Service (PNG SME Edition)
 * Handles Purchase Orders, Supplier Bills, Landed Cost allocation,
 * and 3% Business Payments Tax (BPT) for non-COC suppliers.
 */

import { prisma } from '@/lib/prisma';
import { getNextDocumentNumber } from './document.service';
import { calculateTotals, calculateLineTotals } from '@/lib/utils';
import { z } from 'zod';
import { POStatus, BillStatus } from '@prisma/client';

export const createPOSchema = z.object({
  supplierId: z.string(),
  projectId: z.string().optional(),
  orderDate: z.date().optional(),
  expectedDate: z.date().optional(),
  currency: z.string().default('PGK'),
  taxRate: z.number().default(10), // 10% GST
  notes: z.string().optional(),
  lines: z.array(
    z.object({
      itemId: z.string().optional(),
      description: z.string().min(1),
      quantity: z.number().positive(),
      unitPrice: z.number().nonnegative(),
      unit: z.string().default('PCS'),
      discountPercent: z.number().default(0),
    })
  ),
});

export const createLandedCostSchema = z.object({
  billId: z.string().optional(), // Linked freight or customs bill
  totalFreight: z.number().nonnegative().default(0),
  totalDuty: z.number().nonnegative().default(0),
  totalOther: z.number().nonnegative().default(0),
  allocationMethod: z.enum(['VALUE', 'QUANTITY']).default('VALUE'),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      itemId: z.string(),
      quantity: z.number().positive(),
      baseCost: z.number().nonnegative(),
    })
  ),
});

/**
 * Create Purchase Order
 */
export async function createPurchaseOrder(data: z.infer<typeof createPOSchema>, createdBy: string) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: data.supplierId },
  });

  if (!supplier) throw new Error('Supplier not found');

  const docNumber = await getNextDocumentNumber({ type: 'PURCHASE_ORDER' });
  const linesWithNo = data.lines.map((line, index) => ({
    ...line,
    lineNo: index + 1,
  }));

  const { subtotal, taxTotal, total } = calculateTotals(linesWithNo, data.taxRate);

  const po = await prisma.purchaseOrder.create({
    data: {
      code: docNumber.documentNumber,
      supplierId: data.supplierId,
      projectId: data.projectId,
      orderDate: data.orderDate || new Date(),
      expectedDate: data.expectedDate,
      status: POStatus.DRAFT,
      currency: data.currency,
      subtotal,
      taxTotal,
      total,
      notes: data.notes,
      createdBy,
      lines: {
        create: linesWithNo.map((line) => {
          const calc = calculateLineTotals({
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent,
            taxRate: data.taxRate,
          });

          return {
            lineNo: line.lineNo,
            itemId: line.itemId,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            unit: line.unit,
            taxRate: data.taxRate,
            taxAmount: calc.taxAmount,
            amount: calc.amount,
          };
        }),
      },
    },
    include: {
      lines: true,
      supplier: true,
    },
  });

  return po;
}

/**
 * Allocate Landed Cost (Sea/Air Freight & Customs Duty) onto Received Items
 */
export async function allocateLandedCost(data: z.infer<typeof createLandedCostSchema>, createdBy: string) {
  const totalLandedCost = data.totalFreight + data.totalDuty + data.totalOther;
  if (totalLandedCost <= 0) throw new Error('Total landed cost must be greater than zero');
  if (data.items.length === 0) throw new Error('No items selected for landed cost allocation');

  // Compute basis for allocation
  const totalValue = data.items.reduce((sum, item) => sum + item.quantity * item.baseCost, 0);
  const totalQty = data.items.reduce((sum, item) => sum + item.quantity, 0);

  const voucherCode = `LCV-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;

  // Distribute landed cost to each item
  const allocatedItems = data.items.map((item) => {
    let itemShare = 0;
    if (data.allocationMethod === 'VALUE') {
      const itemTotalValue = item.quantity * item.baseCost;
      itemShare = totalValue > 0 ? (itemTotalValue / totalValue) * totalLandedCost : 0;
    } else {
      itemShare = totalQty > 0 ? (item.quantity / totalQty) * totalLandedCost : 0;
    }

    const additionalCostPerUnit = item.quantity > 0 ? itemShare / item.quantity : 0;
    const finalUnitCost = item.baseCost + additionalCostPerUnit;

    return {
      itemId: item.itemId,
      quantity: item.quantity,
      baseCost: item.baseCost,
      allocatedCost: parseFloat(itemShare.toFixed(2)),
      finalUnitCost: parseFloat(finalUnitCost.toFixed(2)),
    };
  });

  const voucher = await prisma.landedCostVoucher.create({
    data: {
      code: voucherCode,
      billId: data.billId,
      totalFreight: data.totalFreight,
      totalDuty: data.totalDuty,
      totalOther: data.totalOther,
      totalCost: totalLandedCost,
      allocationMethod: data.allocationMethod,
      notes: data.notes,
      status: 'POSTED',
      createdBy,
      items: {
        create: allocatedItems.map((ai) => ({
          itemId: ai.itemId,
          quantity: ai.quantity,
          baseCost: ai.baseCost,
          allocatedCost: ai.allocatedCost,
          finalUnitCost: ai.finalUnitCost,
        })),
      },
    },
    include: {
      items: true,
    },
  });

  // Update Item purchasePrice with new landed unit cost
  for (const item of allocatedItems) {
    await prisma.item.update({
      where: { id: item.itemId },
      data: {
        purchasePrice: item.finalUnitCost,
      },
    });
  }

  return voucher;
}

/**
 * Record Supplier Payment with 3% BPT Check
 * In PNG, if a subcontractor doesn't have a valid COC, payer must withhold 3% Business Payments Tax
 */
export async function recordSupplierPayment(
  billId: string,
  paymentData: {
    amount: number;
    paymentDate: Date;
    paymentMethod: string;
    reference?: string;
    bptDeduction?: number; // 3% BPT deduction
  },
  createdBy: string
) {
  const bill = await prisma.supplierBill.findUnique({
    where: { id: billId },
    include: { supplier: true },
  });

  if (!bill) throw new Error('Supplier bill not found');

  const outstanding = Number(bill.outstanding);
  const payAmount = Number(paymentData.amount || 0);
  const bpt = Number(paymentData.bptDeduction || 0);
  const totalSettlement = payAmount + bpt;

  if (totalSettlement > outstanding + 0.01) {
    throw new Error('Settlement exceeds outstanding bill balance');
  }

  const payment = await prisma.payment.create({
    data: {
      code: `PAY-SUP-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`,
      type: 'SUPPLIER_PAYMENT',
      date: paymentData.paymentDate,
      amount: payAmount,
      bptDeduction: bpt,
      currency: bill.currency,
      paymentMethod: paymentData.paymentMethod,
      status: 'CLEARED',
      supplierId: bill.supplierId,
      billId: bill.id,
      notes: paymentData.reference,
      createdBy,
    },
  });

  const newOutstanding = Math.max(0, outstanding - totalSettlement);
  const updatedBill = await prisma.supplierBill.update({
    where: { id: billId },
    data: {
      amountPaid: Number(bill.amountPaid) + totalSettlement,
      outstanding: newOutstanding,
      status: newOutstanding <= 0.01 ? BillStatus.PAID : BillStatus.PARTIAL,
    },
  });

  return { bill: updatedBill, payment };
}
