import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const coa = await prisma.chartOfAccounts.count();
  const items = await prisma.item.count();
  const cust = await prisma.customer.count();
  const supp = await prisma.supplier.count();
  const bank = await prisma.bankAccount.count();
  const emp = await prisma.employee.count();
  const proj = await prisma.project.count();
  const users = await prisma.user.count();
  const settings = await prisma.globalSettings.findMany();

  const settingsObj = Object.fromEntries(settings.map(s => [s.key, s.value]));

  console.log('--- DATABASE SEED VERIFICATION ---');
  console.log(JSON.stringify({
    users,
    company: settingsObj.company_name,
    address: settingsObj.company_address,
    currency: settingsObj.currency,
    chartOfAccounts: coa,
    bankAccounts: bank,
    items: items,
    customers: cust,
    suppliers: supp,
    projects: proj,
    employees: emp,
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
