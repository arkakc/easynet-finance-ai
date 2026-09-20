/**
 * Payroll Service (Papua New Guinea SME Edition)
 * Handles Fortnightly Salary & Wages Tax (IRC SWT),
 * Superannuation (Employer 8.4%, Employee 6.0% - Nasfund/Nambawan Super),
 * and automatic General Ledger posting.
 */

import { prisma } from '@/lib/prisma';
import { getOrCreateAccount } from './accounting.service';
import { documentSeriesId } from '@/lib/accounting/document-numbering';
import { z } from 'zod';

export const createEmployeeSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  department: z.string().optional(),
  position: z.string().optional(),
  tin: z.string().optional(), // IRC TIN
  nasfundNo: z.string().optional(),
  superFundName: z.string().default('Nasfund'),
  baseSalary: z.number().positive(), // Fortnightly Gross Pay in PGK
  payFrequency: z.enum(['FORTNIGHTLY', 'MONTHLY']).default('FORTNIGHTLY'),
  bankName: z.string().default('BSP'),
  bankAccountNo: z.string().optional(),
});

/**
 * Calculate PNG Fortnightly Salary & Wages Tax (SWT)
 * Based on current PNG IRC resident tax brackets:
 * K0 - K20,000: 0%
 * K20,001 - K33,000: 30%
 * K33,001 - K70,000: 35%
 * K70,001 - K250,000: 40%
 * Above K250,000: 42%
 */
export function calculateFortnightlySWT(fortnightlyGross: number): number {
  const annualGross = fortnightlyGross * 26;
  let annualTax = 0;

  if (annualGross <= 20000) {
    annualTax = 0;
  } else if (annualGross <= 33000) {
    annualTax = (annualGross - 20000) * 0.3;
  } else if (annualGross <= 70000) {
    annualTax = (33000 - 20000) * 0.3 + (annualGross - 33000) * 0.35;
  } else if (annualGross <= 250000) {
    annualTax = (33000 - 20000) * 0.3 + (70000 - 33000) * 0.35 + (annualGross - 70000) * 0.4;
  } else {
    annualTax =
      (33000 - 20000) * 0.3 +
      (70000 - 33000) * 0.35 +
      (250000 - 70000) * 0.4 +
      (annualGross - 250000) * 0.42;
  }

  const fortnightlyTax = annualTax / 26;
  return parseFloat(fortnightlyTax.toFixed(2));
}

/**
 * Calculate Superannuation Contributions in PNG
 * Employer: 8.4%
 * Employee: 6.0%
 */
export function calculateSuperannuation(grossPay: number) {
  const employerSuper = parseFloat((grossPay * 0.084).toFixed(2));
  const employeeSuper = parseFloat((grossPay * 0.06).toFixed(2));
  return {
    employerSuper,
    employeeSuper,
    totalSuper: parseFloat((employerSuper + employeeSuper).toFixed(2)),
  };
}

/**
 * Execute Fortnightly Payroll Run for active employees
 */
export async function processPayrollRun(
  data: {
    periodStart: Date;
    periodEnd: Date;
    paymentDate?: Date;
    notes?: string;
  },
  createdBy: string
) {
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
  });

  if (employees.length === 0) {
    throw new Error('No active employees found to process payroll');
  }

  const payrollCode = documentSeriesId('Payroll');

  let totalGross = 0;
  let totalSwt = 0;
  let totalEmployerSuper = 0;
  let totalEmployeeSuper = 0;
  let totalNet = 0;

  const items = employees.map((emp) => {
    const gross = Number(emp.baseSalary);
    const swt = calculateFortnightlySWT(gross);
    const superContrib = calculateSuperannuation(gross);
    const net = parseFloat((gross - swt - superContrib.employeeSuper).toFixed(2));

    totalGross += gross;
    totalSwt += swt;
    totalEmployerSuper += superContrib.employerSuper;
    totalEmployeeSuper += superContrib.employeeSuper;
    totalNet += net;

    return {
      employeeId: emp.id,
      grossPay: gross,
      swtTax: swt,
      employerSuper: superContrib.employerSuper,
      employeeSuper: superContrib.employeeSuper,
      netPay: net,
    };
  });

  const payrollRun = await prisma.payrollRun.create({
    data: {
      code: payrollCode,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      paymentDate: data.paymentDate || new Date(),
      totalGross: parseFloat(totalGross.toFixed(2)),
      totalSwt: parseFloat(totalSwt.toFixed(2)),
      totalEmployerSuper: parseFloat(totalEmployerSuper.toFixed(2)),
      totalEmployeeSuper: parseFloat(totalEmployeeSuper.toFixed(2)),
      totalNet: parseFloat(totalNet.toFixed(2)),
      status: 'APPROVED',
      notes: data.notes,
      createdBy,
      items: {
        create: items,
      },
    },
    include: {
      items: {
        include: {
          employee: true,
        },
      },
    },
  });

  // Automatically post double-entry General Ledger entry for Payroll
  // Reuse the controlled PNG chart of accounts. These codes already exist in
  // the seeded COA; creating legacy 6000/2210-style duplicates would split
  // payroll reporting and make the month-end control unreliable.
  const grossExpenseAcc = await getOrCreateAccount('6110', 'Salaries & Wages (Core Office & Tech)', 'EXPENSE');
  const superExpenseAcc = await getOrCreateAccount('6120', 'Nasfund Superannuation (8.4% Employer)', 'EXPENSE');
  const swtPayableAcc = await getOrCreateAccount('2124', 'IRC Salary & Wages Tax (SWT) Payable', 'LIABILITY');
  const superPayableAcc = await getOrCreateAccount('2131', 'Nasfund Superannuation Payable', 'LIABILITY');
  const wagesPayableAcc = await getOrCreateAccount('2132', 'Accrued Salaries & Net Wages', 'LIABILITY');

  const journalCode = documentSeriesId('Journal');
  const totalDebit = totalGross + totalEmployerSuper;
  const totalCredit = totalNet + totalSwt + (totalEmployerSuper + totalEmployeeSuper);

  const journal = await prisma.journalHeader.create({
    data: {
      code: journalCode,
      date: payrollRun.paymentDate,
      sourceDocType: 'PAYROLL',
      reference: payrollRun.code,
      description: `Payroll Run ${payrollRun.code} (${data.periodStart.toISOString().split('T')[0]} to ${data.periodEnd.toISOString().split('T')[0]})`,
      totalDebit: parseFloat(totalDebit.toFixed(2)),
      totalCredit: parseFloat(totalCredit.toFixed(2)),
      isBalanced: true,
      status: 'POSTED',
      createdBy,
      lines: {
        create: [
          // Dr. Gross Salaries Expense
          {
            lineNo: 1,
            accountId: grossExpenseAcc.id,
            debit: parseFloat(totalGross.toFixed(2)),
            credit: 0,
            amount: parseFloat(totalGross.toFixed(2)),
            currency: 'PGK',
            description: 'Salaries & Wages Gross Expense',
          },
          // Dr. Employer Superannuation Expense (8.4%)
          {
            lineNo: 2,
            accountId: superExpenseAcc.id,
            debit: parseFloat(totalEmployerSuper.toFixed(2)),
            credit: 0,
            amount: parseFloat(totalEmployerSuper.toFixed(2)),
            currency: 'PGK',
            description: 'Employer Superannuation Expense (8.4% Nasfund)',
          },
          // Cr. IRC Salary & Wages Tax Payable
          {
            lineNo: 3,
            accountId: swtPayableAcc.id,
            debit: 0,
            credit: parseFloat(totalSwt.toFixed(2)),
            amount: parseFloat(totalSwt.toFixed(2)),
            currency: 'PGK',
            description: 'IRC SWT Tax Deductions Payable',
          },
          // Cr. Superannuation Fund Payable (Nasfund/Nambawan Super 14.4%)
          {
            lineNo: 4,
            accountId: superPayableAcc.id,
            debit: 0,
            credit: parseFloat((totalEmployerSuper + totalEmployeeSuper).toFixed(2)),
            amount: parseFloat((totalEmployerSuper + totalEmployeeSuper).toFixed(2)),
            currency: 'PGK',
            description: 'Superannuation Fund Payable (14.4%)',
          },
          // Cr. Net Wages Payable (Employees net pay)
          {
            lineNo: 5,
            accountId: wagesPayableAcc.id,
            debit: 0,
            credit: parseFloat(totalNet.toFixed(2)),
            amount: parseFloat(totalNet.toFixed(2)),
            currency: 'PGK',
            description: 'Net Wages Payable / Bank Clearing',
          },
        ],
      },
    },
  });

  const updated = await prisma.payrollRun.update({
    where: { id: payrollRun.id },
    data: {
      glPosted: true,
      journalId: journal.id,
    },
  });

  return updated;
}
