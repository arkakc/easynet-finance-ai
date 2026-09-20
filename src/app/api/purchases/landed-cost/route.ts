import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/auth';
import { allocateLandedCost, createLandedCostSchema } from '@/src/lib/services/purchase.service';

export async function GET() {
  try {
    await requirePermission('purchase.read');
    const vouchers = await prisma.landedCostVoucher.findMany({
      include: {
        bill: {
          select: { id: true, code: true, supplier: { select: { name: true } } },
        },
        items: {
          include: {
            item: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
      take: 50,
    });

    return NextResponse.json({ success: true, data: vouchers });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch landed cost vouchers';
    return NextResponse.json({ success: false, error: msg }, { status: msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requirePermission('purchase.write');
    const body = await request.json();
    const validated = createLandedCostSchema.parse(body);

    const voucher = await allocateLandedCost(validated, 'system_user');
    return NextResponse.json({ success: true, data: voucher }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to allocate landed cost';
    return NextResponse.json({ success: false, error: msg }, { status: msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 400 });
  }
}
