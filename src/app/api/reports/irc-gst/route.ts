import { NextRequest, NextResponse } from 'next/server';
import { generateIrcGst01Return } from '@/src/lib/services/accounting.service';
import { requirePermission } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    await requirePermission('reports.read');
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const year = parseInt(searchParams.get('year') || String(now.getFullYear()), 10);
    const month = parseInt(searchParams.get('month') || String(now.getMonth() + 1), 10);
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ success: false, error: 'year and month must be valid PNG reporting period values' }, { status: 400 });
    }

    const report = await generateIrcGst01Return(year, month);
    return NextResponse.json({ success: true, data: report });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to generate IRC GST-01 report';
    return NextResponse.json({ success: false, error: msg }, { status: msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 400 });
  }
}
