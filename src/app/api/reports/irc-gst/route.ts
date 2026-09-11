import { NextRequest, NextResponse } from 'next/server';
import { generateIrcGst01Return } from '@/src/lib/services/accounting.service';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const year = parseInt(searchParams.get('year') || String(now.getFullYear()), 10);
    const month = parseInt(searchParams.get('month') || String(now.getMonth() + 1), 10);

    const report = await generateIrcGst01Return(year, month);
    return NextResponse.json({ success: true, data: report });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to generate IRC GST-01 report';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
