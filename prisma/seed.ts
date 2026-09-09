/**
 * Prisma Database Seed Script
 * Populates initial data for Easynet Mini ERP
 */

import { PrismaClient, Role, UserStatus, ProjectStatus, ItemType, QuoteStatus, InvoiceStatus, POStatus, BillStatus, PaymentType, PaymentStatus, JournalStatus, AccountTypeGL, NormalBalance, DocumentType, DocumentStatus, TaxType, TaxReportStatus, ApprovalStatus, ApprovalPriority } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ============================================
  // ROLES & PERMISSIONS (via user roles)
  // ============================================
  
  const roles = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@easynet.local' },
      update: {},
      create: {
        email: 'admin@easynet.local',
        name: 'System Administrator',
        password: await bcrypt.hash('Admin123!', 12),
        role: Role.SYSTEM_MANAGER,
        status: UserStatus.ACTIVE,
      },
    }),
    prisma.user.upsert({
      where: { email: 'controller@easynet.local' },
      update: {},
      create: {
        email: 'controller@easynet.local',
        name: 'Finance Controller',
        password: await bcrypt.hash('Controller123!', 12),
        role: Role.FINANCE_CONTROLLER,
        status: UserStatus.ACTIVE,
      },
    }),
    prisma.user.upsert({
      where: { email: 'sales@easynet.local' },
      update: {},
      create: {
        email: 'sales@easynet.local',
        name: 'Sales Manager',
        password: await bcrypt.hash('Sales123!', 12),
        role: Role.SALES_USER,
        status: UserStatus.ACTIVE,
      },
    }),
    prisma.user.upsert({
      where: { email: 'purchase@easynet.local' },
      update: {},
      create: {
        email: 'purchase@easynet.local',
        name: 'Purchase Manager',
        password: await bcrypt.hash('Purchase123!', 12),
        role: Role.PURCHASE_USER,
        status: UserStatus.ACTIVE,
      },
    }),
    prisma.user.upsert({
      where: { email: 'stock@easynet.local' },
      update: {},
      create: {
        email: 'stock@easynet.local',
        name: 'Inventory Manager',
        password: await bcrypt.hash('Stock123!', 12),
        role: Role.STOCK_USER,
        status: UserStatus.ACTIVE,
      },
    }),
    prisma.user.upsert({
      where: { email: 'manager@easynet.local' },
      update: {},
      create: {
        email: 'manager@easynet.local',
        name: 'Company Manager',
        password: await bcrypt.hash('Manager123!', 12),
        role: Role.MANAGEMENT,
        status: UserStatus.ACTIVE,
      },
    }),
  ]);

  console.log(`✓ Created ${roles.length} users`);

  // ============================================
  // SETTINGS
  // ============================================

  await prisma.globalSettings.upsert({
    where: { key: 'company_name' },
    update: {},
    create: {
      key: 'company_name',
      value: 'Easynet Solutions',
      description: 'Company display name',
    },
  });

  await prisma.globalSettings.upsert({
    where: { key: 'currency' },
    update: {},
    create: {
      key: 'currency',
      value: 'USD',
      description: 'Default currency',
    },
  });

  await prisma.globalSettings.upsert({
    where: { key: 'tax_rate' },
    update: {},
    create: {
      key: 'tax_rate',
      valueDecimal: 10,
      description: 'Default tax rate (%)',
    },
  });

  await prisma.globalSettings.upsert({
    where: { key: 'fiscal_year_start' },
    update: {},
    create: {
      key: 'fiscal_year_start',
      value: '01-01',
      description: 'Fiscal year start (MM-DD)',
    },
  });

  console.log('✓ Created global settings');

  // ============================================
  // CURRENCY
  // ============================================

  const currencies = [
    { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 },
    { code: 'EUR', name: 'Euro', symbol: '€', decimalPlaces: 2 },
    { code: 'GBP', name: 'British Pound', symbol: '£', decimalPlaces: 2 },
    { code: 'PGK', name: 'Papua New Guinea Kina', symbol: 'K', decimalPlaces: 2 },
  ];

  for (const currency of currencies) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: {},
      create: currency,
    });
  }

  console.log('✓ Created currencies');

  // ============================================
  // TAXES
  // ============================================

  await prisma.taxCode.upsert({
    where: { code: 'GST' },
    update: {},
    create: {
      code: 'GST',
      name: 'Goods and Services Tax',
      type: TaxType.GST,
      rate: 10,
      compound: false,
      refundable: true,
      includedInPrice: false,
      isActive: true,
      description: '10% GST on taxable supplies',
    },
  });

  await prisma.taxCode.upsert({
    where: { code: 'NONE' },
    update: {},
    create: {
      code: 'NONE',
      name: 'No Tax',
      type: TaxType.OTHER,
      rate: 0,
      compound: false,
      refundable: false,
      includedInPrice: false,
      isActive: true,
      description: 'No tax applicable',
    },
  });

  console.log('✓ Created tax codes');

  // ============================================
  // CHART OF ACCOUNTS
  // ============================================

  const accounts = [
    // Assets
    { code: '1000', name: 'Assets', type: AccountTypeGL.ASSET, normalBalance: NormalBalance.DEBIT, isSystem: true },
    { code: '1100', name: 'Current Assets', type: AccountTypeGL.ASSET, parentId: '1000', normalBalance: NormalBalance.DEBIT },
    { code: '1110', name: 'Cash on Hand', type: AccountTypeGL.ASSET, parentId: '1100', normalBalance: NormalBalance.DEBIT },
    { code: '1120', name: 'Bank Accounts', type: AccountTypeGL.ASSET, parentId: '1100', normalBalance: NormalBalance.DEBIT },
    { code: '1130', name: 'Accounts Receivable', type: AccountTypeGL.ASSET, parentId: '1100', normalBalance: NormalBalance.DEBIT },
    { code: '1140', name: 'Inventory', type: AccountTypeGL.ASSET, parentId: '1100', normalBalance: NormalBalance.DEBIT },
    { code: '1150', name: 'Prepaid Expenses', type: AccountTypeGL.ASSET, parentId: '1100', normalBalance: NormalBalance.DEBIT },
    { code: '1200', name: 'Non-Current Assets', type: AccountTypeGL.ASSET, parentId: '1000', normalBalance: NormalBalance.DEBIT },
    { code: '1210', name: 'Property, Plant & Equipment', type: AccountTypeGL.ASSET, parentId: '1200', normalBalance: NormalBalance.DEBIT },
    { code: '1220', name: 'Accumulated Depreciation', type: AccountTypeGL.CONTRA_ASSET, parentId: '1200', normalBalance: NormalBalance.CREDIT },
    
    // Liabilities
    { code: '2000', name: 'Liabilities', type: AccountTypeGL.LIABILITY, normalBalance: NormalBalance.CREDIT, isSystem: true },
    { code: '2100', name: 'Current Liabilities', type: AccountTypeGL.LIABILITY, parentId: '2000', normalBalance: NormalBalance.CREDIT },
    { code: '2110', name: 'Accounts Payable', type: AccountTypeGL.LIABILITY, parentId: '2100', normalBalance: NormalBalance.CREDIT },
    { code: '2120', name: 'Credit Card Payable', type: AccountTypeGL.LIABILITY, parentId: '2100', normalBalance: NormalBalance.CREDIT },
    { code: '2130', name: 'Accrued Expenses', type: AccountTypeGL.LIABILITY, parentId: '2100', normalBalance: NormalBalance.CREDIT },
    { code: '2140', name: 'Customer Advances', type: AccountTypeGL.LIABILITY, parentId: '2100', normalBalance: NormalBalance.CREDIT },
    { code: '2200', name: 'Non-Current Liabilities', type: AccountTypeGL.LIABILITY, parentId: '2000', normalBalance: NormalBalance.CREDIT },
    { code: '2210', name: 'Long-term Loans', type: AccountTypeGL.LIABILITY, parentId: '2200', normalBalance: NormalBalance.CREDIT },
    
    // Equity
    { code: '3000', name: 'Equity', type: AccountTypeGL.EQUITY, normalBalance: NormalBalance.CREDIT, isSystem: true },
    { code: '3100', name: 'Owner\'s Capital', type: AccountTypeGL.EQUITY, parentId: '3000', normalBalance: NormalBalance.CREDIT },
    { code: '3200', name: 'Retained Earnings', type: AccountTypeGL.EQUITY, parentId: '3000', normalBalance: NormalBalance.CREDIT },
    { code: '3300', name: 'Current Year Earnings', type: AccountTypeGL.EQUITY, parentId: '3000', normalBalance: NormalBalance.CREDIT },
    
    // Revenue
    { code: '4000', name: 'Revenue', type: AccountTypeGL.REVENUE, normalBalance: NormalBalance.CREDIT, isSystem: true },
    { code: '4100', name: 'Sales Revenue', type: AccountTypeGL.REVENUE, parentId: '4000', normalBalance: NormalBalance.CREDIT },
    { code: '4200', name: 'Service Revenue', type: AccountTypeGL.REVENUE, parentId: '4000', normalBalance: NormalBalance.CREDIT },
    { code: '4300', name: 'Other Income', type: AccountTypeGL.REVENUE, parentId: '4000', normalBalance: NormalBalance.CREDIT },
    
    // Expenses
    { code: '5000', name: 'Cost of Goods Sold', type: AccountTypeGL.EXPENSE, normalBalance: NormalBalance.DEBIT, isSystem: true },
    { code: '5100', name: 'Purchases', type: AccountTypeGL.EXPENSE, parentId: '5000', normalBalance: NormalBalance.DEBIT },
    { code: '5200', name: 'Direct Labor', type: AccountTypeGL.EXPENSE, parentId: '5000', normalBalance: NormalBalance.DEBIT },
    { code: '6000', name: 'Operating Expenses', type: AccountTypeGL.EXPENSE, normalBalance: NormalBalance.DEBIT, isSystem: true },
    { code: '6100', name: 'Rent & Lease', type: AccountTypeGL.EXPENSE, parentId: '6000', normalBalance: NormalBalance.DEBIT },
    { code: '6200', name: 'Utilities', type: AccountTypeGL.EXPENSE, parentId: '6000', normalBalance: NormalBalance.DEBIT },
    { code: '6300', name: 'Salaries & Wages', type: AccountTypeGL.EXPENSE, parentId: '6000', normalBalance: NormalBalance.DEBIT },
    { code: '6400', name: 'Marketing & Advertising', type: AccountTypeGL.EXPENSE, parentId: '6000', normalBalance: NormalBalance.DEBIT },
    { code: '6500', name: 'Office Supplies', type: AccountTypeGL.EXPENSE, parentId: '6000', normalBalance: NormalBalance.DEBIT },
    { code: '6600', name: 'Insurance', type: AccountTypeGL.EXPENSE, parentId: '6000', normalBalance: NormalBalance.DEBIT },
    { code: '6700', name: 'Professional Fees', type: AccountTypeGL.EXPENSE, parentId: '6000', normalBalance: NormalBalance.DEBIT },
    { code: '6800', name: 'Travel & Entertainment', type: AccountTypeGL.EXPENSE, parentId: '6000', normalBalance: NormalBalance.DEBIT },
    { code: '6900', name: 'Depreciation Expense', type: AccountTypeGL.EXPENSE, parentId: '6000', normalBalance: NormalBalance.DEBIT },
  ];

  for (const account of accounts) {
    await prisma.chartOfAccounts.upsert({
      where: { code: account.code },
      update: {},
      create: account,
    });
  }

  console.log('✓ Created chart of accounts');

  // ============================================
  // BANK ACCOUNTS
  // ============================================

  await prisma.bankAccount.upsert({
    where: { code: 'BANK-001' },
    update: {},
    create: {
      code: 'BANK-001',
      name: 'Main Operating Account',
      bankName: 'National Bank',
      accountType: 'CHECKING',
      currency: 'USD',
      isActive: true,
      openingBalance: 15000,
      openingDate: new Date('2024-01-01'),
    },
  });

  await prisma.bankAccount.upsert({
    where: { code: 'BANK-002' },
    update: {},
    create: {
      code: 'BANK-002',
      name: 'Payroll Account',
      bankName: 'National Bank',
      accountType: 'CHECKING',
      currency: 'USD',
      isActive: true,
      openingBalance: 5000,
      openingDate: new Date('2024-01-01'),
    },
  });

  await prisma.bankAccount.upsert({
    where: { code: 'CASH-001' },
    update: {},
    create: {
      code: 'CASH-001',
      name: 'Petty Cash',
      bankName: 'N/A',
      accountType: 'PETTY_CASH',
      currency: 'USD',
      isActive: true,
      openingBalance: 500,
      openingDate: new Date('2024-01-01'),
    },
  });

  console.log('✓ Created bank accounts');

  // ============================================
  // CUSTOMERS
  // ============================================

  const customers = [
    { code: 'CUST-001', name: 'Apex Manufacturing Ltd', taxId: 'GST-12345-6789', phone: '+1-555-0101', email: 'orders@apexmfg.com', paymentTerms: 30, creditLimit: 50000 },
    { code: 'CUST-002', name: 'Pacific Retail Group', taxId: 'GST-98765-4321', phone: '+1-555-0102', email: 'buying@pacificretail.com', paymentTerms: 14, creditLimit: 25000 },
    { code: 'CUST-003', name: 'Tech Solutions Inc', taxId: 'GST-11111-2222', phone: '+1-555-0103', email: ' procurement@techsolutions.com', paymentTerms: 30, creditLimit: 75000 },
    { code: 'CUST-004', name: 'Global Logistics Corp', taxId: 'GST-33333-4444', phone: '+1-555-0104', email: 'accounts@globallogistics.com', paymentTerms: 45, creditLimit: 100000 },
    { code: 'CUST-005', name: 'Small Business Hub', taxId: 'GST-55555-6666', phone: '+1-555-0105', email: 'info@smallbusinesshub.com', paymentTerms: 7, creditLimit: 5000 },
  ];

  for (const customer of customers) {
    await prisma.customer.upsert({
      where: { code: customer.code },
      update: {},
      create: customer,
    });
  }

  console.log('✓ Created customers');

  // ============================================
  // SUPPLIERS
  // ============================================

  const suppliers = [
    { code: 'SUP-001', name: 'Pacific Hardware Supplies', taxId: 'GST-SUP-001', phone: '+1-555-0201', email: 'sales@pacifichardware.com', paymentTerms: 30 },
    { code: 'SUP-002', name: 'TechParts Direct', taxId: 'GST-SUP-002', phone: '+1-555-0202', email: 'orders@techparts.com', paymentTerms: 14 },
    { code: 'SUP-003', name: 'Office Essentials Co', taxId: 'GST-SUP-003', phone: '+1-555-0203', email: 'accounts@officeessentials.com', paymentTerms: 30 },
    { code: 'SUP-004', name: 'Logistics Partners Ltd', taxId: 'GST-SUP-004', phone: '+1-555-0204', email: 'dispatch@logpartners.com', paymentTerms: 14 },
  ];

  for (const supplier of suppliers) {
    await prisma.supplier.upsert({
      where: { code: supplier.code },
      update: {},
      create: supplier,
    });
  }

  console.log('✓ Created suppliers');

  // ============================================
  // ITEMS
  // ============================================

  const items = [
    { code: 'ITM-001', name: 'Computer Workstation', description: 'Dell Optiplex 5000, 16GB RAM, 512GB SSD', category: 'Hardware', sku: 'DELL-OP5000', unit: 'PCS', type: ItemType.GOOD, purchasePrice: 850, sellPrice: 1250, trackQty: true, minStock: 10 },
    { code: 'ITM-002', name: '27" Monitor 1440p', description: 'LG 27UK650-W, 27 inch, 4K UHD', category: 'Hardware', sku: 'LG-27UK650', unit: 'PCS', type: ItemType.GOOD, purchasePrice: 320, sellPrice: 499, trackQty: true, minStock: 20 },
    { code: 'ITM-003', name: 'Wireless Keyboard', description: 'Logitech K380, Bluetooth, multi-device', category: 'Accessories', sku: 'LOGI-K380', unit: 'PCS', type: ItemType.GOOD, purchasePrice: 25, sellPrice: 49, trackQty: true, minStock: 50 },
    { code: 'ITM-004', name: 'Wireless Mouse', description: 'Logitech M510, wireless, USB receiver', category: 'Accessories', sku: 'LOGI-M510', unit: 'PCS', type: ItemType.GOOD, purchasePrice: 15, sellPrice: 29, trackQty: true, minStock: 50 },
    { code: 'ITM-005', name: 'USB-C Cable 2m', description: 'Anker PowerLine III, USB-C to USB-C, 2 meter', category: 'Cables', sku: 'ANKER-UCS2', unit: 'PCS', type: ItemType.GOOD, purchasePrice: 8, sellPrice: 19, trackQty: true, minStock: 100 },
    { code: 'ITM-006', name: 'Technical Support Hour', description: 'Hourly technical support service', category: 'Services', sku: 'SVC-TECH-HR', unit: 'HR', type: ItemType.SERVICE, sellPrice: 150 },
    { code: 'ITM-007', name: 'Installation Service', description: 'On-site hardware installation and setup', category: 'Services', sku: 'SVC-INST', unit: 'VISIT', type: ItemType.SERVICE, sellPrice: 250 },
    { code: 'ITM-008', name: 'Annual Maintenance Contract', description: 'One year of preventive maintenance', category: 'Services', sku: 'SVC-AMC-1YR', unit: 'YEAR', type: ItemType.SERVICE, sellPrice: 1200 },
    { code: 'ITM-009', name: 'Office Chair', description: 'Ergonomic office chair, mesh back', category: 'Furniture', sku: 'OFCH-ERG-001', unit: 'PCS', type: ItemType.GOOD, purchasePrice: 180, sellPrice: 350, trackQty: true, minStock: 5 },
    { code: 'ITM-010', name: 'Desk Lamp LED', description: 'LED desk lamp, adjustable brightness', category: 'Accessories', sku: 'LED-DL-001', unit: 'PCS', type: ItemType.GOOD, purchasePrice: 22, sellPrice: 45, trackQty: true, minStock: 20 },
  ];

  for (const item of items) {
    await prisma.item.upsert({
      where: { code: item.code },
      update: {},
      create: item,
    });
  }

  console.log('✓ Created items');

  // ============================================
  // PROJECTS
  // ============================================

  const projects = [
    { code: 'PROJ-001', name: 'Office Renovation - Floor 3', description: 'Complete IT infrastructure upgrade for Floor 3', customerId: 'CUST-001', startDate: new Date('2024-03-01'), endDate: new Date('2024-06-30'), budget: 150000, status: ProjectStatus.ACTIVE },
    { code: 'PROJ-002', name: 'IT Equipment Refresh', description: 'Refresh workstations for 50 employees', customerId: 'CUST-003', startDate: new Date('2024-04-01'), endDate: new Date('2024-08-31'), budget: 75000, status: ProjectStatus.ACTIVE },
    { code: 'PROJ-003', name: 'Warehouse Automation', description: 'Implement automated inventory tracking', customerId: 'CUST-004', startDate: new Date('2024-05-01'), endDate: new Date('2024-10-31'), budget: 250000, status: ProjectStatus.PLANNING },
  ];

  for (const project of projects) {
    await prisma.project.upsert({
      where: { code: project.code },
      update: {},
      create: project,
    });
  }

  console.log('✓ Created projects');

  // ============================================
  // SAMPLE SALES QUOTATION
  // ============================================

  const quote = await prisma.quote.create({
    data: {
      code: 'QT-2024-00001',
      customerId: 'CUST-001',
      projectId: 'PROJ-001',
      validUntil: new Date('2024-03-15'),
      status: QuoteStatus.SENT,
      currency: 'USD',
      subtotal: 12500,
      taxTotal: 1250,
      discountTotal: 0,
      total: 13750,
      notes: 'Prices valid for 30 days. Delivery included.',
      terms: 'Payment due within 30 days of invoice date.',
      createdBy: 'admin@easynet.local',
      lines: {
        create: [
          { lineNo: 1, description: 'Computer Workstation - Dell Optiplex 5000', quantity: 10, unitPrice: 1250, unit: 'PCS', taxRate: 10, taxAmount: 1250, amount: 12500 },
          { lineNo: 2, description: 'Wireless Keyboard - Logitech K380', quantity: 10, unitPrice: 49, unit: 'PCS', taxRate: 10, taxAmount: 49, amount: 490 },
          { lineNo: 3, description: 'Wireless Mouse - Logitech M510', quantity: 10, unitPrice: 29, unit: 'PCS', taxRate: 10, taxAmount: 29, amount: 290 },
        ],
      },
    },
  });

  console.log('✓ Created sample quotation');

  // ============================================
  // SAMPLE INVOICE
  // ============================================

  const invoice = await prisma.invoice.create({
    data: {
      code: 'INV-2024-00001',
      customerId: 'CUST-001',
      projectId: 'PROJ-001',
      issuedDate: new Date('2024-02-15'),
      dueDate: new Date('2024-03-16'),
      status: InvoiceStatus.SENT,
      currency: 'USD',
      subtotal: 12500,
      taxTotal: 1250,
      discountTotal: 0,
      total: 13750,
      amountPaid: 0,
      outstanding: 13750,
      notes: 'Thank you for your business.',
      terms: 'Payment due within 30 days. Please quote invoice number on payment.',
      createdBy: 'admin@easynet.local',
      poReference: 'PO-2024-001',
      lines: {
        create: [
          { lineNo: 1, description: 'Computer Workstation - Dell Optiplex 5000', quantity: 10, unitPrice: 1250, unit: 'PCS', taxRate: 10, taxAmount: 1250, amount: 12500 },
          { lineNo: 2, description: 'Wireless Keyboard - Logitech K380', quantity: 10, unitPrice: 49, unit: 'PCS', taxRate: 10, taxAmount: 49, amount: 490 },
          { lineNo: 3, description: 'Wireless Mouse - Logitech M510', quantity: 10, unitPrice: 29, unit: 'PCS', taxRate: 10, taxAmount: 29, amount: 290 },
        ],
      },
    },
  });

  console.log('✓ Created sample invoice');

  // ============================================
  // SAMPLE PURCHASE ORDER
  // ============================================

  const purchaseOrder = await prisma.purchaseOrder.create({
    data: {
      code: 'PO-2024-00001',
      supplierId: 'SUP-001',
      projectId: 'PROJ-001',
      orderDate: new Date('2024-02-10'),
      expectedDate: new Date('2024-02-20'),
      status: POStatus.SENT,
      currency: 'USD',
      subtotal: 8500,
      taxTotal: 850,
      freight: 200,
      discountTotal: 0,
      total: 9550,
      notes: 'Rush delivery requested.',
      createdBy: 'admin@easynet.local',
      lines: {
        create: [
          { lineNo: 1, itemId: 'ITM-001', description: 'Computer Workstation - Dell Optiplex 5000', quantity: 10, unitPrice: 850, unit: 'PCS', taxRate: 10, taxAmount: 850, amount: 8500 },
        ],
      },
    },
  });

  console.log('✓ Created sample purchase order');

  // ============================================
  // SAMPLE JOURNAL ENTRY
  // ============================================

  const journal = await prisma.journalHeader.create({
    data: {
      code: 'JRN-2024-00001',
      date: new Date('2024-02-28'),
      description: 'Opening balances for February 2024',
      status: JournalStatus.POSTED,
      currency: 'USD',
      totalDebit: 20500,
      totalCredit: 20500,
      isBalanced: true,
      createdBy: 'admin@easynet.local',
      postedAt: new Date('2024-02-28'),
      lines: {
        create: [
          { lineNo: 1, accountId: '1110', description: 'Opening cash balance', debit: 15000, credit: 0, amount: 15000 },
          { lineNo: 2, accountId: '1130', description: 'Opening accounts receivable', debit: 5500, credit: 0, amount: 5500 },
          { lineNo: 3, accountId: '3100', description: 'Opening equity', debit: 0, credit: 20500, amount: 20500 },
        ],
      },
    },
  });

  console.log('✓ Created sample journal entry');

  // ============================================
  // SAMPLE BANK TRANSACTION
  // ============================================

  await prisma.bankTransaction.createMany({
    data: [
      { code: 'TXN-2024-00001', bankAccountId: 'BANK-001', date: new Date('2024-02-28'), type: 'DEPOSIT', description: 'Initial deposit', amount: 15000, category: 'Opening Balance' },
      { code: 'TXN-2024-00002', bankAccountId: 'BANK-001', date: new Date('2024-03-01'), type: 'WITHDRAWAL', description: 'Office supplies purchase', amount: -250, category: 'Office Supplies' },
      { code: 'TXN-2024-00003', bankAccountId: 'BANK-001', date: new Date('2024-03-05'), type: 'DEPOSIT', description: 'Customer payment - Apex Manufacturing', amount: 13750, category: 'Sales Revenue' },
    ],
    skipDuplicates: true,
  });

  console.log('✓ Created sample bank transactions');

  console.log('\n✅ Database seeding completed successfully!');
  console.log('\n📝 Test Accounts:');
  console.log('   Admin: admin@easynet.local / Admin123!');
  console.log('   Controller: controller@easynet.local / Controller123!');
  console.log('   Sales: sales@easynet.local / Sales123!');
  console.log('   Purchase: purchase@easynet.local / Purchase123!');
  console.log('   Stock: stock@easynet.local / Stock123!');
  console.log('   Manager: manager@easynet.local / Manager123!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
