import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { processPayrollRun } from '@/src/lib/services/payroll.service';
import { requirePermission } from '@/lib/auth';
import { z } from 'zod';

const datePattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const runSchema = z.object({
  periodStart: z.string().regex(datePattern, 'periodStart must use YYYY-MM-DD'),
  periodEnd: z.string().regex(datePattern, 'periodEnd must use YYYY-MM-DD'),
  paymentDate: z.string().regex(datePattern, 'paymentDate must use YYYY-MM-DD'),
  notes: z.string().trim().max(500).optional().default(''),
  confirmation: z.string(),
});

function pngDate(value: string, endOfDay = false) {
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+10:00`);
  if (Number.isNaN(date.getTime()) || date.toLocaleDateString('en-CA', { timeZone: 'Pacific/Port_Moresby' }) !== value) throw new Error('Invalid PNG accounting date');
  return date;
}

function status(error: unknown) {
  const message = error instanceof Error ? error.message : 'Payroll request failed';
  return NextResponse.json({ success: false, error: message }, { status: message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : /locked|already exists|confirm/i.test(message) ? 409 : 400 });
}

export async function GET() {
  try {
    await requirePermission('accounts.read');
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
    const [employees, payrollJournals] = await Promise.all([
      prisma.employee.findMany({ where: { isActive: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, department: true, position: true, baseSalary: true, payFrequency: true, superFundName: true } }),
      prisma.journalHeader.findMany({ where: { status: 'POSTED', sourceDocType: 'PAYROLL' }, orderBy: { date: 'desc' }, take: 100, select: { id: true, code: true, date: true, reference: true, totalDebit: true, totalCredit: true } }),
    ]);
    const registeredJournalIds = new Set(runs.map((run) => run.journalId).filter(Boolean));
    const unregisteredPayrollJournals = payrollJournals.filter((journal) => !registeredJournalIds.has(journal.id)).map((journal) => ({ id: journal.id, code: journal.code, date: journal.date.toISOString(), reference: journal.reference || '', totalDebit: Number(journal.totalDebit), totalCredit: Number(journal.totalCredit) }));
    return NextResponse.json({ success: true, data: runs, employees, unregisteredPayrollJournals });
  } catch (error: unknown) {
    return status(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission('post.approve');
    const body = runSchema.parse(await request.json());
    if (body.confirmation !== `PROCESS PAYROLL ${body.periodStart} TO ${body.periodEnd}`) throw new Error(`Type PROCESS PAYROLL ${body.periodStart} TO ${body.periodEnd} to confirm`);
    const periodStart = pngDate(body.periodStart);
    const periodEnd = pngDate(body.periodEnd, true);
    const paymentDate = pngDate(body.paymentDate);
    if (periodStart > periodEnd) throw new Error('periodStart must be on or before periodEnd');
    const [existing, activeEmployees, lock] = await Promise.all([
      prisma.payrollRun.findFirst({ where: { periodStart: { lte: periodEnd }, periodEnd: { gte: periodStart }, status: { not: 'CANCELLED' } }, select: { code: true } }),
      prisma.employee.count({ where: { isActive: true } }),
      prisma.globalSettings.findUnique({ where: { key: 'posting_lock_date' }, select: { value: true } }),
    ]);
    if (existing) throw new Error(`A payroll run already covers this period: ${existing.code}`);
    if (!activeEmployees) throw new Error('No active employees found to process payroll');
    const lockValue = lock?.value;
    const lockDate = lockValue && datePattern.test(lockValue) ? pngDate(lockValue, true) : null;
    if (lockDate && paymentDate <= lockDate) throw new Error(`Payroll payment date is locked through ${lockValue}`);

    const run = await processPayrollRun(
      {
        periodStart,
        periodEnd,
        paymentDate,
        notes: body.notes,
      },
      user.email,
    );
    const dbUser = await prisma.user.findUnique({ where: { email: user.email }, select: { id: true } });
    if (dbUser) await prisma.auditLog.create({ data: { action: 'POST', entityType: 'PayrollRun', entityId: run.id, entityCode: run.code, description: `Processed payroll for ${body.periodStart} to ${body.periodEnd}`, changes: JSON.stringify({ paymentDate: body.paymentDate, journalId: run.journalId, totalGross: run.totalGross, totalNet: run.totalNet }), userId: dbUser.id } });
    return NextResponse.json({ success: true, data: run }, { status: 201 });
  } catch (error: unknown) {
    return status(error);
  }
}
