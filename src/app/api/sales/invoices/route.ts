import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/auth';
import { createInvoice, createInvoiceSchema, postInvoiceToGL } from '@/src/lib/services/sales.service';

export async function GET(request: NextRequest) {
  try {
    await requirePermission('sales.read');
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const customerId = searchParams.get('customerId');

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        customer: {
          select: { id: true, code: true, name: true, tin: true },
        },
        project: {
          select: { id: true, code: true, name: true },
        },
        lines: true,
      },
      orderBy: { issuedDate: 'desc' },
      take: 100,
    });

    return NextResponse.json({ success: true, data: invoices });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch invoices';
    return NextResponse.json({ success: false, error: msg }, { status: msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requirePermission('sales.write');
    const body = await request.json();
    const validated = createInvoiceSchema.parse(body);

    const invoice = await createInvoice(validated, 'system_user');
    const { invoice: postedInvoice, journal } = await postInvoiceToGL(invoice.id, 'system_user');
    return NextResponse.json({ success: true, data: postedInvoice, journalId: journal.id }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create invoice';
    return NextResponse.json({ success: false, error: msg }, { status: msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 400 });
  }
}
