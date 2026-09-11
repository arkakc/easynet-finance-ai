import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { processPayrollRun } from '@/src/lib/services/payroll.service';

export async function GET() {
  try {
    const runs = await prisma.payrollRun.findMany({
      include: {
        items: {
          include: {
            employee: {
              select: { id: true, code: true, name: true, department: true, position: true },
            },
          },
        },
      },
      orderBy: { periodStart: 'desc' },
      take: 24,
    });

    return NextResponse.json({ success: true, data: runs });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch payroll runs';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { periodStart, periodEnd, paymentDate, notes } = body;

    if (!periodStart || !periodEnd) {
      return NextResponse.json(
        { success: false, error: 'periodStart and periodEnd are required' },
        { status: 400 }
      );
    }

    const run = await processPayrollRun(
      {
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        notes,
      },
      'system_user'
    );

    return NextResponse.json({ success: true, data: run }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to process payroll run';
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}
