/**
 * Prisma Database Seed Script for Easynet IT Solutions Limited
 * 100% Papua New Guinea-Owned Technology Solutions Provider
 * Port Moresby, Papua New Guinea | https://www.easynetpng.com/
 */

import {
  PrismaClient,
  Role,
  UserStatus,
  ProjectStatus,
  ItemType,
  AccountTypeGL,
  NormalBalance,
  TaxType,
  JournalStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { INITIAL_CHART_OF_ACCOUNTS } from '../lib/accounting/chart-of-accounts';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Easynet IT Solutions Limited (PNG) database...');

  // ============================================
  // 1. ROLES & USERS
  // ============================================
  const roles = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@easynet.local' },
      update: {},
      create: {
        email: 'admin@easynet.local',
        name: 'Arka C (System Administrator)',
        password: await bcrypt.hash('Admin123!', 12),
        role: Role.SYSTEM_MANAGER,
        status: UserStatus.ACTIVE,
      },
    }),
    prisma.user.upsert({
      where: { email: 'willie@easynet.local' },
      update: {},
      create: {
        email: 'willie@easynet.local',
        name: 'Willie Batia (Director)',
        password: await bcrypt.hash('Director123!', 12),
        role: Role.MANAGEMENT,
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
      where: { email: 'field@easynet.local' },
      update: {},
      create: {
        email: 'field@easynet.local',
        name: 'Max Giamungi (Field Coordinator)',
        password: await bcrypt.hash('Field123!', 12),
        role: Role.STOCK_USER,
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
        name: 'Procurement Officer',
        password: await bcrypt.hash('Purchase123!', 12),
        role: Role.PURCHASE_USER,
        status: UserStatus.ACTIVE,
      },
    }),
  ]);

  console.log(`✓ Created ${roles.length} core corporate users`);

  // ============================================
  // 2. COMPANY PROFILE & GLOBAL SETTINGS
  // ============================================
  const settings = [
    { key: 'company_name', value: 'Easynet IT Solutions Limited', description: 'Company legal registered name' },
    { key: 'company_short_name', value: 'Easynet PNG', description: 'Trading name' },
    { key: 'company_slogan', value: 'Technology Solutions for Growing Businesses', description: 'Company slogan' },
    { key: 'company_address', value: '8 Mile, Gran Eden, Lot 110, Section 147, Port Moresby, NCD, Papua New Guinea', description: 'Head office address' },
    { key: 'company_phone', value: '+675 72743186', description: 'Official corporate phone' },
    { key: 'company_email', value: 'hello.easynet@hotmail.com', description: 'Official corporate email' },
    { key: 'company_website', value: 'https://www.easynetpng.com/', description: 'Official corporate website' },
    { key: 'company_tin', value: 'TIN-50012389', description: 'IRC Tax Identification Number' },
    { key: 'currency', value: 'PGK', description: 'Primary operating currency (Papua New Guinea Kina)' },
    { key: 'tax_rate', valueDecimal: 10, description: 'Standard IRC Goods and Services Tax (%)' },
    { key: 'fiscal_year_start', value: '01-01', description: 'Fiscal year start date (MM-DD)' },
  ];

  for (const setting of settings) {
    await prisma.globalSettings.upsert({
      where: { key: setting.key },
      update: setting,
      create: setting,
    });
  }

  console.log('✓ Created company profile & global settings (Port Moresby, PNG)');

  // ============================================
  // 3. CURRENCIES
  // ============================================
  const currencies = [
    { code: 'PGK', name: 'Papua New Guinea Kina', symbol: 'K', decimalPlaces: 2 },
    { code: 'USD', name: 'US Dollar', symbol: '$', decimalPlaces: 2 },
    { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimalPlaces: 2 },
  ];

  for (const curr of currencies) {
    await prisma.currency.upsert({
      where: { code: curr.code },
      update: {},
      create: curr,
    });
  }

  console.log('✓ Created multi-currencies (PGK primary, USD & AUD trade)');

  // ============================================
  // 4. TAX CODES (IRC PAPUA NEW GUINEA)
  // ============================================
  const taxCodes = [
    {
      code: 'GST-10',
      name: 'IRC GST (10%)',
      type: TaxType.GST,
      rate: 10,
      compound: false,
      refundable: true,
      includedInPrice: false,
      isActive: true,
      description: 'Standard 10% Goods & Services Tax under PNG IRC Form GST-01',
    },
    {
      code: 'GST-S65A',
      name: 'IRC Section 65A GST Withholding',
      type: TaxType.GST,
      rate: 10,
      compound: false,
      refundable: true,
      includedInPrice: false,
      isActive: true,
      description: 'Section 65A GST Withheld by Designated Government / Large PNG Entities',
    },
    {
      code: 'ZERO',
      name: 'Zero Rated (0%)',
      type: TaxType.OTHER,
      rate: 0,
      compound: false,
      refundable: false,
      includedInPrice: false,
      isActive: true,
      description: '0% Zero-rated supply',
    },
    {
      code: 'EXEMPT',
      name: 'Tax Exempt',
      type: TaxType.OTHER,
      rate: 0,
      compound: false,
      refundable: false,
      includedInPrice: false,
      isActive: true,
      description: 'Exempt supply / financial transactions',
    },
  ];

  for (const tax of taxCodes) {
    await prisma.taxCode.upsert({
      where: { code: tax.code },
      update: tax,
      create: tax,
    });
  }

  console.log('✓ Created IRC tax codes (GST 10%, Section 65A, Exempt)');

  // ============================================
  // 5. CHART OF ACCOUNTS (EASYNET IT SOLUTIONS PNG)
  // ============================================
  const accounts: Array<{
    code: string;
    name: string;
    type: AccountTypeGL;
    parentId?: string;
    normalBalance: NormalBalance;
    isSystem?: boolean;
    description?: string;
  }> = [
    // ----------------------------------------------------
    // 1000 - ASSETS
    // ----------------------------------------------------
    { code: '1000', name: 'Assets', type: AccountTypeGL.ASSET, normalBalance: NormalBalance.DEBIT, isSystem: true, description: 'Master Asset Group' },
    
    // 1100 - Current Assets
    { code: '1100', name: 'Current Assets', type: AccountTypeGL.ASSET, parentId: '1000', normalBalance: NormalBalance.DEBIT, isSystem: true },
    
    // 1110 - Cash & Cash Equivalents
    { code: '1110', name: 'Cash on Hand', type: AccountTypeGL.ASSET, parentId: '1100', normalBalance: NormalBalance.DEBIT },
    { code: '1111', name: 'Petty Cash - Port Moresby Office', type: AccountTypeGL.ASSET, parentId: '1110', normalBalance: NormalBalance.DEBIT, description: 'Petty cash for Port Moresby 8 Mile office' },
    { code: '1112', name: 'Field Operations Cash Float', type: AccountTypeGL.ASSET, parentId: '1110', normalBalance: NormalBalance.DEBIT, description: 'Cash float for provincial on-site field team' },
    
    // 1120 - Bank Accounts
    { code: '1120', name: 'Bank Accounts', type: AccountTypeGL.ASSET, parentId: '1100', normalBalance: NormalBalance.DEBIT },
    { code: '1121', name: 'BSP Operating Account (PGK)', type: AccountTypeGL.ASSET, parentId: '1120', normalBalance: NormalBalance.DEBIT, description: 'Bank South Pacific primary operating checking' },
    { code: '1122', name: 'Kina Bank Operating Account (PGK)', type: AccountTypeGL.ASSET, parentId: '1120', normalBalance: NormalBalance.DEBIT, description: 'Kina Bank secondary & payroll disbursement account' },
    { code: '1123', name: 'Westpac PNG Operating Account (PGK)', type: AccountTypeGL.ASSET, parentId: '1120', normalBalance: NormalBalance.DEBIT, description: 'Westpac corporate account' },
    { code: '1124', name: 'Foreign Currency Account - USD', type: AccountTypeGL.ASSET, parentId: '1120', normalBalance: NormalBalance.DEBIT, description: 'USD account for overseas software licensing & cloud' },
    { code: '1125', name: 'Foreign Currency Account - AUD', type: AccountTypeGL.ASSET, parentId: '1120', normalBalance: NormalBalance.DEBIT, description: 'AUD account for regional equipment imports' },

    // 1130 - Accounts Receivable
    { code: '1130', name: 'Accounts Receivable', type: AccountTypeGL.ASSET, parentId: '1100', normalBalance: NormalBalance.DEBIT },
    { code: '1131', name: 'Trade Debtors (PGK)', type: AccountTypeGL.ASSET, parentId: '1130', normalBalance: NormalBalance.DEBIT, description: 'Outstanding customer invoices for services & hardware' },
    { code: '1132', name: 'Allowance for Doubtful Debts', type: AccountTypeGL.CONTRA_ASSET, parentId: '1130', normalBalance: NormalBalance.CREDIT, description: 'Provision for uncollectible receivables' },
    { code: '1133', name: 'Contract Retentions Receivable', type: AccountTypeGL.ASSET, parentId: '1130', normalBalance: NormalBalance.DEBIT, description: 'Client retentions held until project sign-off' },

    // 1140 - Inventory & Work in Progress
    { code: '1140', name: 'Inventory & Materials', type: AccountTypeGL.ASSET, parentId: '1100', normalBalance: NormalBalance.DEBIT },
    { code: '1141', name: 'Inventory - Computers, Laptops & Desktops', type: AccountTypeGL.ASSET, parentId: '1140', normalBalance: NormalBalance.DEBIT, description: 'Dell, HP, Lenovo computers for resale' },
    { code: '1142', name: 'Inventory - Networking Switches & Routers', type: AccountTypeGL.ASSET, parentId: '1140', normalBalance: NormalBalance.DEBIT, description: 'Ubiquiti, MikroTik, Cisco networking hardware' },
    { code: '1143', name: 'Inventory - Structured Cabling & Racks', type: AccountTypeGL.ASSET, parentId: '1140', normalBalance: NormalBalance.DEBIT, description: 'Cat6 bulk cable, patch panels, server rack cabinets' },
    { code: '1144', name: 'Inventory - CCTV Cameras & NVR Systems', type: AccountTypeGL.ASSET, parentId: '1140', normalBalance: NormalBalance.DEBIT, description: 'Hikvision, Dahua IP cameras & recorders' },
    { code: '1145', name: 'Inventory - Starlink Kits & Satellite Hardware', type: AccountTypeGL.ASSET, parentId: '1140', normalBalance: NormalBalance.DEBIT, description: 'Starlink terminals, roof mounts, adapters' },
    { code: '1146', name: 'Inventory - UPS & Power Protection Systems', type: AccountTypeGL.ASSET, parentId: '1140', normalBalance: NormalBalance.DEBIT, description: 'APC, Eaton UPS batteries and power conditioners' },
    { code: '1147', name: 'Inventory - Peripherals & Consumables', type: AccountTypeGL.ASSET, parentId: '1140', normalBalance: NormalBalance.DEBIT, description: 'Monitors, keyboards, mice, toner cartridges' },
    { code: '1148', name: 'Work in Progress (Client Projects WIP)', type: AccountTypeGL.ASSET, parentId: '1140', normalBalance: NormalBalance.DEBIT, description: 'Unbilled project installation costs & equipment' },

    // 1150 - Prepayments & Deposits
    { code: '1150', name: 'Prepayments & Deposits', type: AccountTypeGL.ASSET, parentId: '1100', normalBalance: NormalBalance.DEBIT },
    { code: '1151', name: 'Prepaid Office Rent & Facilities', type: AccountTypeGL.ASSET, parentId: '1150', normalBalance: NormalBalance.DEBIT },
    { code: '1152', name: 'Prepaid Software & Cloud Subscriptions', type: AccountTypeGL.ASSET, parentId: '1150', normalBalance: NormalBalance.DEBIT },
    { code: '1153', name: 'Security & Utility Deposits', type: AccountTypeGL.ASSET, parentId: '1150', normalBalance: NormalBalance.DEBIT },

    // 1200 - Non-Current Assets (Fixed Assets)
    { code: '1200', name: 'Non-Current Assets', type: AccountTypeGL.ASSET, parentId: '1000', normalBalance: NormalBalance.DEBIT },
    { code: '1210', name: 'Property, Plant & Equipment', type: AccountTypeGL.ASSET, parentId: '1200', normalBalance: NormalBalance.DEBIT },
    { code: '1211', name: 'Internal IT & Lab Servers', type: AccountTypeGL.ASSET, parentId: '1210', normalBalance: NormalBalance.DEBIT, description: 'Office development workstations, demo servers & lab' },
    { code: '1212', name: 'Motor Vehicles (Field Operations Fleet)', type: AccountTypeGL.ASSET, parentId: '1210', normalBalance: NormalBalance.DEBIT, description: 'Field service support vehicles for Port Moresby & provinces' },
    { code: '1213', name: 'Office Furniture & Fixtures', type: AccountTypeGL.ASSET, parentId: '1210', normalBalance: NormalBalance.DEBIT },
    { code: '1214', name: 'Field Installation Tools & Testers', type: AccountTypeGL.ASSET, parentId: '1210', normalBalance: NormalBalance.DEBIT, description: 'Fluke cable certifiers, fusion splicers, ladders' },

    // 1220 - Accumulated Depreciation
    { code: '1220', name: 'Accumulated Depreciation', type: AccountTypeGL.CONTRA_ASSET, parentId: '1200', normalBalance: NormalBalance.CREDIT },
    { code: '1221', name: 'Accum. Depr. - Internal IT & Servers', type: AccountTypeGL.CONTRA_ASSET, parentId: '1220', normalBalance: NormalBalance.CREDIT },
    { code: '1222', name: 'Accum. Depr. - Motor Vehicles', type: AccountTypeGL.CONTRA_ASSET, parentId: '1220', normalBalance: NormalBalance.CREDIT },
    { code: '1223', name: 'Accum. Depr. - Office Furniture & Fixtures', type: AccountTypeGL.CONTRA_ASSET, parentId: '1220', normalBalance: NormalBalance.CREDIT },
    { code: '1224', name: 'Accum. Depr. - Field Tools & Testers', type: AccountTypeGL.CONTRA_ASSET, parentId: '1220', normalBalance: NormalBalance.CREDIT },

    // ----------------------------------------------------
    // 2000 - LIABILITIES
    // ----------------------------------------------------
    { code: '2000', name: 'Liabilities', type: AccountTypeGL.LIABILITY, normalBalance: NormalBalance.CREDIT, isSystem: true, description: 'Master Liability Group' },
    
    // 2100 - Current Liabilities
    { code: '2100', name: 'Current Liabilities', type: AccountTypeGL.LIABILITY, parentId: '2000', normalBalance: NormalBalance.CREDIT, isSystem: true },
    
    // 2110 - Accounts Payable
    { code: '2110', name: 'Accounts Payable', type: AccountTypeGL.LIABILITY, parentId: '2100', normalBalance: NormalBalance.CREDIT },
    { code: '2111', name: 'Trade Creditors (PGK)', type: AccountTypeGL.LIABILITY, parentId: '2110', normalBalance: NormalBalance.CREDIT, description: 'Local supplier bills and vendor invoices' },
    { code: '2112', name: 'Overseas Vendor Payables (USD/AUD)', type: AccountTypeGL.LIABILITY, parentId: '2110', normalBalance: NormalBalance.CREDIT, description: 'Hardware suppliers, Starlink, AWS, Microsoft CSP' },

    // 2120 - Statutory Taxes (IRC PNG)
    { code: '2120', name: 'IRC Statutory Taxes Payable', type: AccountTypeGL.LIABILITY, parentId: '2100', normalBalance: NormalBalance.CREDIT },
    { code: '2121', name: 'IRC GST Output (Collected 10%)', type: AccountTypeGL.LIABILITY, parentId: '2120', normalBalance: NormalBalance.CREDIT, description: 'Goods & Services Tax collected from clients (Form GST-01)' },
    { code: '2122', name: 'IRC GST Input (Paid 10%)', type: AccountTypeGL.CONTRA_LIABILITY, parentId: '2120', normalBalance: NormalBalance.DEBIT, description: 'Goods & Services Tax paid on business purchases to claim offset' },
    { code: '2123', name: 'IRC Section 65A GST Withholding Payable', type: AccountTypeGL.LIABILITY, parentId: '2120', normalBalance: NormalBalance.CREDIT, description: 'GST withheld under Section 65A certificates' },
    { code: '2124', name: 'IRC Salary & Wages Tax (SWT) Payable', type: AccountTypeGL.LIABILITY, parentId: '2120', normalBalance: NormalBalance.CREDIT, description: 'PAYE / Salary & Wages Tax withheld from fortnightly payroll' },

    // 2130 - Superannuation & Payroll Liabilities
    { code: '2130', name: 'Superannuation & Payroll Liabilities', type: AccountTypeGL.LIABILITY, parentId: '2100', normalBalance: NormalBalance.CREDIT },
    { code: '2131', name: 'Nasfund Superannuation Payable', type: AccountTypeGL.LIABILITY, parentId: '2130', normalBalance: NormalBalance.CREDIT, description: 'Employee 6% + Employer 8.4% superannuation contributions' },
    { code: '2132', name: 'Accrued Salaries & Net Wages', type: AccountTypeGL.LIABILITY, parentId: '2130', normalBalance: NormalBalance.CREDIT, description: 'Net wages payable to employees on fortnightly run' },
    { code: '2133', name: 'Staff Annual Leave Entitlements Accrual', type: AccountTypeGL.LIABILITY, parentId: '2130', normalBalance: NormalBalance.CREDIT },

    // 2140 - Customer Advances & Unearned Revenue
    { code: '2140', name: 'Customer Advances & Deposits', type: AccountTypeGL.LIABILITY, parentId: '2100', normalBalance: NormalBalance.CREDIT },
    { code: '2141', name: 'Customer Project Advance Deposits (50%)', type: AccountTypeGL.LIABILITY, parentId: '2140', normalBalance: NormalBalance.CREDIT, description: 'Initial project milestone deposits received before deployment' },
    { code: '2142', name: 'Unearned SLA Maintenance Contracts', type: AccountTypeGL.LIABILITY, parentId: '2140', normalBalance: NormalBalance.CREDIT, description: 'Billed annual/quarterly managed IT retainer fees' },

    // 2150 - Accrued Operational Expenses
    { code: '2150', name: 'Accrued Operational Expenses', type: AccountTypeGL.LIABILITY, parentId: '2100', normalBalance: NormalBalance.CREDIT },
    { code: '2151', name: 'Accrued Utilities (PNG Power / Water)', type: AccountTypeGL.LIABILITY, parentId: '2150', normalBalance: NormalBalance.CREDIT },
    { code: '2152', name: 'Accrued Professional & Audit Fees', type: AccountTypeGL.LIABILITY, parentId: '2150', normalBalance: NormalBalance.CREDIT },

    // 2200 - Non-Current Liabilities
    { code: '2200', name: 'Non-Current Liabilities', type: AccountTypeGL.LIABILITY, parentId: '2000', normalBalance: NormalBalance.CREDIT },
    { code: '2210', name: 'Commercial Bank Loan / Asset Financing', type: AccountTypeGL.LIABILITY, parentId: '2200', normalBalance: NormalBalance.CREDIT, description: 'Long-term vehicle or equipment finance' },

    // ----------------------------------------------------
    // 3000 - EQUITY
    // ----------------------------------------------------
    { code: '3000', name: 'Equity', type: AccountTypeGL.EQUITY, normalBalance: NormalBalance.CREDIT, isSystem: true, description: 'Master Equity Group' },
    { code: '3100', name: 'Shareholder / Owner Capital', type: AccountTypeGL.EQUITY, parentId: '3000', normalBalance: NormalBalance.CREDIT, description: 'Initial paid-up capital of Easynet IT Solutions Ltd' },
    { code: '3200', name: 'Retained Earnings', type: AccountTypeGL.EQUITY, parentId: '3000', normalBalance: NormalBalance.CREDIT, description: 'Accumulated profits from previous years' },
    { code: '3300', name: 'Current Year Earnings', type: AccountTypeGL.EQUITY, parentId: '3000', normalBalance: NormalBalance.CREDIT, isSystem: true, description: 'Net income from current financial period' },

    // ----------------------------------------------------
    // 4000 - REVENUE / SALES
    // ----------------------------------------------------
    { code: '4000', name: 'Revenue', type: AccountTypeGL.REVENUE, normalBalance: NormalBalance.CREDIT, isSystem: true, description: 'Master Revenue Group' },
    
    // 4100 - Software & Digital Solutions
    { code: '4100', name: 'Software & Digital Solutions Revenue', type: AccountTypeGL.REVENUE, parentId: '4000', normalBalance: NormalBalance.CREDIT },
    { code: '4110', name: 'Website Design & Development Revenue', type: AccountTypeGL.REVENUE, parentId: '4100', normalBalance: NormalBalance.CREDIT, description: 'Business websites, e-commerce, and corporate web portals' },
    { code: '4120', name: 'Digital Marketing & Lead Generation Revenue', type: AccountTypeGL.REVENUE, parentId: '4100', normalBalance: NormalBalance.CREDIT, description: 'Meta, Google advertising, and social media lead funnels' },
    { code: '4130', name: 'WhatsApp Business & Automation Revenue', type: AccountTypeGL.REVENUE, parentId: '4100', normalBalance: NormalBalance.CREDIT, description: 'WhatsApp Business API, chatbot automation & CRM routing' },
    { code: '4140', name: 'ERP Implementation & Consulting Revenue', type: AccountTypeGL.REVENUE, parentId: '4100', normalBalance: NormalBalance.CREDIT, description: 'ERP & Zoho deployments, accounting, inventory, HR' },
    { code: '4150', name: 'Custom Application Development Revenue', type: AccountTypeGL.REVENUE, parentId: '4100', normalBalance: NormalBalance.CREDIT, description: 'Bespoke operational software & API integrations' },

    // 4200 - ICT Infrastructure & Managed Services
    { code: '4200', name: 'ICT Infrastructure & Managed Services Revenue', type: AccountTypeGL.REVENUE, parentId: '4000', normalBalance: NormalBalance.CREDIT },
    { code: '4210', name: 'Managed IT Support SLA Contracts', type: AccountTypeGL.REVENUE, parentId: '4200', normalBalance: NormalBalance.CREDIT, description: 'Monthly and annual ongoing support agreements' },
    { code: '4220', name: 'Network & Structured Cabling Services', type: AccountTypeGL.REVENUE, parentId: '4200', normalBalance: NormalBalance.CREDIT, description: 'LAN/WAN, office Wi-Fi, and data cabling installation' },
    { code: '4230', name: 'Starlink & Satellite Setup Services', type: AccountTypeGL.REVENUE, parentId: '4200', normalBalance: NormalBalance.CREDIT, description: 'Starlink dish installation, mountings, network failover' },
    { code: '4240', name: 'CCTV & Security Camera Installation Services', type: AccountTypeGL.REVENUE, parentId: '4200', normalBalance: NormalBalance.CREDIT, description: 'Security camera deployment, NVR configuration, remote viewing' },
    { code: '4250', name: 'Firewall & Cybersecurity Services', type: AccountTypeGL.REVENUE, parentId: '4200', normalBalance: NormalBalance.CREDIT, description: 'Fortinet/OPNsense hardening, security assessments' },
    { code: '4260', name: 'Server, Cloud & Microsoft 365 Setup Services', type: AccountTypeGL.REVENUE, parentId: '4200', normalBalance: NormalBalance.CREDIT, description: 'Cloud migration, Synology NAS, M365 tenant deployment' },
    { code: '4270', name: 'Backup Solutions & Disaster Recovery Services', type: AccountTypeGL.REVENUE, parentId: '4200', normalBalance: NormalBalance.CREDIT, description: 'Automated off-site cloud backups and recovery drills' },
    { code: '4280', name: 'Ad-hoc Technical Callout & Support Fees', type: AccountTypeGL.REVENUE, parentId: '4200', normalBalance: NormalBalance.CREDIT, description: 'Emergency on-site callouts and hourly support' },

    // 4300 - Hardware & Licensing Sales
    { code: '4300', name: 'Hardware & License Sales', type: AccountTypeGL.REVENUE, parentId: '4000', normalBalance: NormalBalance.CREDIT },
    { code: '4310', name: 'Computers & Laptops Sales', type: AccountTypeGL.REVENUE, parentId: '4300', normalBalance: NormalBalance.CREDIT, description: 'Sales of workstations, laptops, and desktop computers' },
    { code: '4320', name: 'Networking Hardware Sales', type: AccountTypeGL.REVENUE, parentId: '4300', normalBalance: NormalBalance.CREDIT, description: 'Switches, routers, Wi-Fi access points, patch panels' },
    { code: '4330', name: 'CCTV & Surveillance Hardware Sales', type: AccountTypeGL.REVENUE, parentId: '4300', normalBalance: NormalBalance.CREDIT, description: 'IP cameras, NVRs, surveillance hard drives' },
    { code: '4340', name: 'Starlink Kits & Mounting Sales', type: AccountTypeGL.REVENUE, parentId: '4300', normalBalance: NormalBalance.CREDIT, description: 'Starlink terminals, pole mounts, adapters' },
    { code: '4350', name: 'UPS & Power Protection Sales', type: AccountTypeGL.REVENUE, parentId: '4300', normalBalance: NormalBalance.CREDIT, description: 'APC UPS units, surge protectors' },
    { code: '4360', name: 'Software Licensing & Cloud Reselling', type: AccountTypeGL.REVENUE, parentId: '4300', normalBalance: NormalBalance.CREDIT, description: 'Microsoft 365, Antivirus, Backblaze cloud storage' },

    // ----------------------------------------------------
    // 5000 - COST OF GOODS SOLD (DIRECT COSTS)
    // ----------------------------------------------------
    { code: '5000', name: 'Cost of Goods Sold', type: AccountTypeGL.EXPENSE, normalBalance: NormalBalance.DEBIT, isSystem: true, description: 'Master Direct Cost Group' },
    { code: '5100', name: 'Hardware Purchases for Resale', type: AccountTypeGL.EXPENSE, parentId: '5000', normalBalance: NormalBalance.DEBIT, description: 'Cost of laptops, workstations, printers sold to clients' },
    { code: '5200', name: 'Networking & Cabling Equipment Cost', type: AccountTypeGL.EXPENSE, parentId: '5000', normalBalance: NormalBalance.DEBIT, description: 'Cost of switches, routers, bulk Cat6 copper cables' },
    { code: '5300', name: 'CCTV & Security Hardware Cost', type: AccountTypeGL.EXPENSE, parentId: '5000', normalBalance: NormalBalance.DEBIT, description: 'Cost of IP cameras, recorders, surveillance HDDs' },
    { code: '5400', name: 'Starlink Hardware & Mountings Cost', type: AccountTypeGL.EXPENSE, parentId: '5000', normalBalance: NormalBalance.DEBIT, description: 'Cost of Starlink satellite dishes & mounting brackets' },
    { code: '5500', name: 'Software Licenses Purchased for Resale', type: AccountTypeGL.EXPENSE, parentId: '5000', normalBalance: NormalBalance.DEBIT, description: 'Microsoft 365 CSP, CrowdStrike, antivirus licenses' },
    { code: '5600', name: 'Cloud Hosting & Storage Cost (AWS/B2)', type: AccountTypeGL.EXPENSE, parentId: '5000', normalBalance: NormalBalance.DEBIT, description: 'AWS infrastructure, Backblaze B2, domain renewals' },
    { code: '5700', name: 'Subcontractor & Specialist Consulting Fees', type: AccountTypeGL.EXPENSE, parentId: '5000', normalBalance: NormalBalance.DEBIT, description: '8N8 Systems specialist consulting partner fees' },
    { code: '5800', name: 'Direct Field Project Labor & Travel', type: AccountTypeGL.EXPENSE, parentId: '5000', normalBalance: NormalBalance.DEBIT, description: 'Field technician project wages & provincial project travel' },
    { code: '5900', name: 'Customs Duty, Freight & Port Clearance', type: AccountTypeGL.EXPENSE, parentId: '5000', normalBalance: NormalBalance.DEBIT, description: 'Import duties (IRC Customs) & air/sea freight into PNG' },

    // ----------------------------------------------------
    // 6000 - OPERATING EXPENSES (OPEX)
    // ----------------------------------------------------
    { code: '6000', name: 'Operating Expenses', type: AccountTypeGL.EXPENSE, normalBalance: NormalBalance.DEBIT, isSystem: true, description: 'Master Operating Expense Group' },
    
    // 6100 - Personnel & Staff Expenses
    { code: '6100', name: 'Personnel & Payroll Expenses', type: AccountTypeGL.EXPENSE, parentId: '6000', normalBalance: NormalBalance.DEBIT },
    { code: '6110', name: 'Salaries & Wages (Core Office & Tech)', type: AccountTypeGL.EXPENSE, parentId: '6100', normalBalance: NormalBalance.DEBIT, description: 'Regular staff payroll' },
    { code: '6120', name: 'Nasfund Superannuation (8.4% Employer)', type: AccountTypeGL.EXPENSE, parentId: '6100', normalBalance: NormalBalance.DEBIT, description: 'Statutory 8.4% employer superannuation contribution' },
    { code: '6130', name: 'Staff Overtime & Field Work Allowances', type: AccountTypeGL.EXPENSE, parentId: '6100', normalBalance: NormalBalance.DEBIT },
    { code: '6140', name: 'Staff Training & Technical Certifications', type: AccountTypeGL.EXPENSE, parentId: '6100', normalBalance: NormalBalance.DEBIT, description: 'Fortinet, Microsoft, AWS, ERP credentials' },
    { code: '6150', name: 'Staff Protective Equipment (PPE) & Uniforms', type: AccountTypeGL.EXPENSE, parentId: '6100', normalBalance: NormalBalance.DEBIT, description: 'Helmets, boots, vests for field site work' },
    { code: '6160', name: 'Staff Welfare & Medical Costs', type: AccountTypeGL.EXPENSE, parentId: '6100', normalBalance: NormalBalance.DEBIT },

    // 6200 - Facilities & Office Operations
    { code: '6200', name: 'Facilities & Office Operations', type: AccountTypeGL.EXPENSE, parentId: '6000', normalBalance: NormalBalance.DEBIT },
    { code: '6210', name: 'Office Rent (8 Mile, Gran Eden POM)', type: AccountTypeGL.EXPENSE, parentId: '6200', normalBalance: NormalBalance.DEBIT, description: 'Premises lease in Port Moresby' },
    { code: '6220', name: 'Electricity & PNG Power Utility Charges', type: AccountTypeGL.EXPENSE, parentId: '6200', normalBalance: NormalBalance.DEBIT },
    { code: '6230', name: 'Generator Fuel & Power Backup Maintenance', type: AccountTypeGL.EXPENSE, parentId: '6200', normalBalance: NormalBalance.DEBIT, description: 'Diesel for standby generator in Port Moresby' },
    { code: '6240', name: 'Office Water & Sanitation Charges', type: AccountTypeGL.EXPENSE, parentId: '6200', normalBalance: NormalBalance.DEBIT },
    { code: '6250', name: 'Office Security & Premises Guarding', type: AccountTypeGL.EXPENSE, parentId: '6200', normalBalance: NormalBalance.DEBIT, description: '24/7 security guard services' },
    { code: '6260', name: 'Office Cleaning & Maintenance', type: AccountTypeGL.EXPENSE, parentId: '6200', normalBalance: NormalBalance.DEBIT },

    // 6300 - Telecommunications & IT
    { code: '6300', name: 'Telecommunications & Internal IT', type: AccountTypeGL.EXPENSE, parentId: '6000', normalBalance: NormalBalance.DEBIT },
    { code: '6310', name: 'Office High-Speed Internet Transit', type: AccountTypeGL.EXPENSE, parentId: '6300', normalBalance: NormalBalance.DEBIT, description: 'Fibre / Starlink connection at Port Moresby office' },
    { code: '6320', name: 'Mobile Phone & Staff Communication Credits', type: AccountTypeGL.EXPENSE, parentId: '6300', normalBalance: NormalBalance.DEBIT, description: 'Digicel / Vodafone mobile top-ups for technicians' },
    { code: '6330', name: 'Internal SaaS Subscriptions & DevOps Tools', type: AccountTypeGL.EXPENSE, parentId: '6300', normalBalance: NormalBalance.DEBIT, description: 'GitHub, Vercel, Slack, accounting tools' },
    { code: '6340', name: 'Website Hosting & Domain Registrations', type: AccountTypeGL.EXPENSE, parentId: '6300', normalBalance: NormalBalance.DEBIT, description: 'Hosting for easynetpng.com' },

    // 6400 - Motor Vehicles & Logistics
    { code: '6400', name: 'Motor Vehicles & Logistics', type: AccountTypeGL.EXPENSE, parentId: '6000', normalBalance: NormalBalance.DEBIT },
    { code: '6410', name: 'Motor Vehicle Fuel & Oil (Field Fleet)', type: AccountTypeGL.EXPENSE, parentId: '6400', normalBalance: NormalBalance.DEBIT, description: 'Fuel for field project vehicles' },
    { code: '6420', name: 'Motor Vehicle Repairs & Regular Servicing', type: AccountTypeGL.EXPENSE, parentId: '6400', normalBalance: NormalBalance.DEBIT },
    { code: '6430', name: 'Vehicle Insurance & Road Worthy Registrations', type: AccountTypeGL.EXPENSE, parentId: '6400', normalBalance: NormalBalance.DEBIT },
    { code: '6440', name: 'Domestic Airfares (Air Niugini / PNG Air)', type: AccountTypeGL.EXPENSE, parentId: '6400', normalBalance: NormalBalance.DEBIT, description: 'Flights to Lae, Hagen, Madang, Kokopo, mines' },
    { code: '6450', name: 'Provincial Accommodation & Field Meals', type: AccountTypeGL.EXPENSE, parentId: '6400', normalBalance: NormalBalance.DEBIT, description: 'Hotels and daily allowance during provincial jobs' },

    // 6500 - Marketing & Business Development
    { code: '6500', name: 'Marketing & Business Development', type: AccountTypeGL.EXPENSE, parentId: '6000', normalBalance: NormalBalance.DEBIT },
    { code: '6510', name: 'Digital Advertising & Paid Media', type: AccountTypeGL.EXPENSE, parentId: '6500', normalBalance: NormalBalance.DEBIT, description: 'Meta Ads, LinkedIn campaigns' },
    { code: '6520', name: 'Marketing Collateral, Signage & Print', type: AccountTypeGL.EXPENSE, parentId: '6500', normalBalance: NormalBalance.DEBIT, description: 'Brochures, vehicle branding, corporate cards' },
    { code: '6530', name: 'Client Entertainment & Relationship Building', type: AccountTypeGL.EXPENSE, parentId: '6500', normalBalance: NormalBalance.DEBIT },

    // 6600 - General, Administrative & Professional
    { code: '6600', name: 'General & Administrative Expenses', type: AccountTypeGL.EXPENSE, parentId: '6000', normalBalance: NormalBalance.DEBIT },
    { code: '6610', name: 'Legal, Secretarial & IPA Filing Fees', type: AccountTypeGL.EXPENSE, parentId: '6600', normalBalance: NormalBalance.DEBIT, description: 'Investment Promotion Authority (IPA) corporate compliance' },
    { code: '6620', name: 'External Accounting, Audit & Tax Advisory', type: AccountTypeGL.EXPENSE, parentId: '6600', normalBalance: NormalBalance.DEBIT },
    { code: '6630', name: 'Bank Charges & Merchant Transaction Fees', type: AccountTypeGL.EXPENSE, parentId: '6600', normalBalance: NormalBalance.DEBIT, description: 'BSP / Kina Bank transfer fees & merchant services' },
    { code: '6640', name: 'General Commercial Insurance', type: AccountTypeGL.EXPENSE, parentId: '6600', normalBalance: NormalBalance.DEBIT, description: 'Public liability & professional indemnity' },
    { code: '6650', name: 'Office Stationery & Printing Consumables', type: AccountTypeGL.EXPENSE, parentId: '6600', normalBalance: NormalBalance.DEBIT },
    { code: '6660', name: 'Courier, Postage & Local Delivery', type: AccountTypeGL.EXPENSE, parentId: '6600', normalBalance: NormalBalance.DEBIT },
    { code: '6670', name: 'Depreciation Expense - Internal IT & Servers', type: AccountTypeGL.EXPENSE, parentId: '6600', normalBalance: NormalBalance.DEBIT },
    { code: '6680', name: 'Depreciation Expense - Motor Vehicles', type: AccountTypeGL.EXPENSE, parentId: '6600', normalBalance: NormalBalance.DEBIT },
    { code: '6690', name: 'Sundry & Miscellaneous Operating Expenses', type: AccountTypeGL.EXPENSE, parentId: '6600', normalBalance: NormalBalance.DEBIT },
  ];

  // Insert accounts in order (parents created before children)
  for (const account of accounts) {
    const { parentId, ...accountData } = account;

    await prisma.chartOfAccounts.upsert({
      where: { code: account.code },
      update: {
        name: accountData.name,
        type: accountData.type,
        normalBalance: accountData.normalBalance,
        description: accountData.description,
        ...(parentId ? { parent: { connect: { code: parentId } } } : {}),
      },
      create: {
        ...accountData,
        currency: 'PGK',
        ...(parentId ? { parent: { connect: { code: parentId } } } : {}),
      },
    });
  }

  console.log(`✓ Created ${accounts.length} customized Chart of Accounts for Easynet IT Solutions`);

  // The active accounting engine posts to the canonical ACC-xxxx chart. Keep
  // the local seed aligned with that contract so a fresh database passes the
  // accounting self-test without relying on runtime repair.
  const canonicalCodes = new Set(INITIAL_CHART_OF_ACCOUNTS.map((account) => account.accountCode));
  for (const account of INITIAL_CHART_OF_ACCOUNTS) {
    const parentCode = account.parentAccount.replace(/^ACC-/, '') || undefined;
    const typeByName: Record<string, AccountTypeGL> = {
      Asset: AccountTypeGL.ASSET,
      Liability: AccountTypeGL.LIABILITY,
      Equity: AccountTypeGL.EQUITY,
      Income: AccountTypeGL.REVENUE,
      Expense: AccountTypeGL.EXPENSE,
      'Contra Asset': AccountTypeGL.CONTRA_ASSET,
      'Contra Liability': AccountTypeGL.CONTRA_LIABILITY,
    };
    const type = typeByName[account.accountType] || AccountTypeGL.ASSET;
    const normalBalance = ["Liability", "Equity", "Income", "Contra Asset"].includes(account.accountType)
      ? NormalBalance.CREDIT
      : NormalBalance.DEBIT;
    await prisma.chartOfAccounts.upsert({
      where: { code: account.accountCode },
      update: {
        name: account.accountName,
        type,
        normalBalance,
        isActive: account.active,
        ...(parentCode ? { parent: { connect: { code: parentCode } } } : { parent: { disconnect: true } }),
      },
      create: {
        code: account.accountCode,
        name: account.accountName,
        type,
        normalBalance,
        isActive: account.active,
        isSystem: true,
        currency: 'PGK',
        ...(parentCode ? { parent: { connect: { code: parentCode } } } : {}),
      },
    });
  }
  const seededAccounts = await prisma.chartOfAccounts.findMany({ select: { id: true, code: true } });
  const accountIdByCode = new Map(seededAccounts.map((account) => [account.code, account.id]));
  const parentCodes = new Set(INITIAL_CHART_OF_ACCOUNTS.map((account) => account.parentAccount.replace(/^ACC-/, '')).filter(Boolean));
  for (const account of INITIAL_CHART_OF_ACCOUNTS) {
    if (parentCodes.has(account.accountCode)) continue;
    const accountId = accountIdByCode.get(account.accountCode);
    const parentId = accountIdByCode.get(account.parentAccount.replace(/^ACC-/, ''));
    if (!accountId || !parentId) continue;
    await prisma.chartOfAccounts.updateMany({
      where: { parentId: accountId, code: { notIn: [...canonicalCodes] } },
      data: { parentId },
    });
  }

  // ============================================
  // 6. BANK ACCOUNTS
  // ============================================
  const bankAccounts = [
    {
      code: 'BANK-BSP',
      name: 'BSP Main Operating Account',
      bankName: 'Bank South Pacific (BSP)',
      accountNumber: '1008899201',
      accountType: 'CHECKING',
      currency: 'PGK',
      isActive: true,
      openingBalance: 125000,
      openingDate: new Date('2026-01-01'),
      notes: 'Primary operations account at BSP Port Moresby branch',
    },
    {
      code: 'BANK-KINA',
      name: 'Kina Bank Payroll Account',
      bankName: 'Kina Bank',
      accountNumber: '2004455890',
      accountType: 'CHECKING',
      currency: 'PGK',
      isActive: true,
      openingBalance: 35000,
      openingDate: new Date('2026-01-01'),
      notes: 'Fortnightly payroll & tax disbursement account',
    },
    {
      code: 'BANK-WPNG',
      name: 'Westpac PNG Project Account',
      bankName: 'Westpac Bank PNG',
      accountNumber: '3007788112',
      accountType: 'CHECKING',
      currency: 'PGK',
      isActive: true,
      openingBalance: 50000,
      openingDate: new Date('2026-01-01'),
      notes: 'Client milestone advance deposits & retention funds',
    },
    {
      code: 'BANK-USD',
      name: 'Overseas Vendor Account (USD)',
      bankName: 'BSP Foreign Currency Banking',
      accountNumber: 'USD-9922011',
      accountType: 'CHECKING',
      currency: 'USD',
      isActive: true,
      openingBalance: 15000,
      openingDate: new Date('2026-01-01'),
      notes: 'For overseas software licenses, Starlink equipment and AWS hosting',
    },
    {
      code: 'CASH-POM',
      name: 'Petty Cash - Port Moresby Office',
      bankName: 'Easynet Office Safe',
      accountNumber: 'POM-CASH-01',
      accountType: 'PETTY_CASH',
      currency: 'PGK',
      isActive: true,
      openingBalance: 2500,
      openingDate: new Date('2026-01-01'),
      notes: 'Office operational cash float',
    },
  ];

  for (const b of bankAccounts) {
    const ledgerCodeByBank: Record<string, string> = {
      'BANK-BSP': '1121',
      'BANK-KINA': '1122',
      'BANK-WPNG': '1123',
      'BANK-USD': '1124',
      'CASH-POM': '1111',
    };
    const ledgerAccountId = accountIdByCode.get(ledgerCodeByBank[b.code]);
    await prisma.bankAccount.upsert({
      where: { code: b.code },
      update: { ...b, chartOfAccountsId: ledgerAccountId || null },
      create: { ...b, chartOfAccountsId: ledgerAccountId || null },
    });
  }

  console.log(`✓ Created ${bankAccounts.length} PNG & foreign currency bank accounts`);

  // ============================================
  // 7. REAL ITEMS & SERVICE PACKAGES
  // ============================================
  const items = [
    // Packages (Bundles from easynetpng.com)
    { code: 'PKG-STARTER', name: 'Business Starter Package', description: 'Business website, corporate email, social media setup and online presence launch', category: 'Packages', sku: 'PKG-START', unit: 'PACKAGE', type: ItemType.SERVICE, sellPrice: 2500 },
    { code: 'PKG-GROWTH', name: 'Digital Growth Package', description: 'Everything in Starter + Meta/Google advertising, lead management & WhatsApp automation', category: 'Packages', sku: 'PKG-GROW', unit: 'PACKAGE', type: ItemType.SERVICE, sellPrice: 5500 },
    { code: 'PKG-AUTOMATION', name: 'Business Automation Package', description: 'Everything in Growth + CRM, sales, purchasing, inventory & accounting ERP', category: 'Packages', sku: 'PKG-AUTO', unit: 'PACKAGE', type: ItemType.SERVICE, sellPrice: 12500 },
    { code: 'PKG-OFFICE-SETUP', name: 'IT Office Setup Package', description: 'Computers, Wi-Fi, firewall, CCTV, backup, Microsoft 365 and business software', category: 'Packages', sku: 'PKG-OFFICE', unit: 'PACKAGE', type: ItemType.SERVICE, sellPrice: 18500 },
    { code: 'PKG-MANAGED-IT', name: 'Managed IT Support (Monthly SLA)', description: 'Monthly remote support, server/network monitoring, maintenance & security contracts', category: 'Packages', sku: 'PKG-MGMT-MO', unit: 'MONTH', type: ItemType.SERVICE, sellPrice: 3200 },

    // Software & Digital Services
    { code: 'SVC-WEB-CORP', name: 'Corporate Multi-Page Website', description: 'Custom responsive corporate website with SEO, hosting setup & staff training', category: 'Software Services', sku: 'SVC-WEB-CORP', unit: 'PROJECT', type: ItemType.SERVICE, sellPrice: 4800 },
    { code: 'SVC-WHATSAPP-API', name: 'WhatsApp Business Automation Setup', description: 'WhatsApp Business API integration, auto-replies, lead routing & AI chatbot', category: 'Software Services', sku: 'SVC-WA-API', unit: 'SETUP', type: ItemType.SERVICE, sellPrice: 2200 },
    { code: 'SVC-ERP-DEPLOY', name: 'ERP / Zoho Implementation', description: 'Full ERP deployment for accounting, inventory, purchasing, POS and payroll in PNG', category: 'Software Services', sku: 'SVC-ERP-DEP', unit: 'PROJECT', type: ItemType.SERVICE, sellPrice: 16000 },

    // ICT Infrastructure Services
    { code: 'SVC-STARLINK-INST', name: 'Starlink Commercial Installation & Failover', description: 'Satellite dish mounting, cabling, router integration & failover network config', category: 'Infrastructure Services', sku: 'SVC-STARLINK', unit: 'SITE', type: ItemType.SERVICE, sellPrice: 1850 },
    { code: 'SVC-CCTV-POINT', name: 'CCTV Camera Installation & NVR Setup (Per Point)', description: 'Cable pull, bracket mount, IP camera termination, NVR channel config & phone app', category: 'Infrastructure Services', sku: 'SVC-CCTV-PT', unit: 'POINT', type: ItemType.SERVICE, sellPrice: 280 },
    { code: 'SVC-DATA-CABLE', name: 'Structured Cat6 Data Cabling (Per Drop)', description: 'Cat6 UTP cable installation, RJ45 termination, faceplate & patch panel labelling', category: 'Infrastructure Services', sku: 'SVC-CABLE-PT', unit: 'DROP', type: ItemType.SERVICE, sellPrice: 160 },
    { code: 'SVC-CONSULT-HR', name: 'Senior IT Consultant / Engineer Callout', description: 'Hourly certified senior engineer technical support & diagnostic services', category: 'Support Services', sku: 'SVC-TECH-HR', unit: 'HOUR', type: ItemType.SERVICE, sellPrice: 250 },

    // Physical Hardware for Resale (Stock Items)
    { code: 'HW-DELL-7000', name: 'Dell OptiPlex 7000 Workstation', description: 'Intel Core i7, 16GB RAM, 512GB NVMe SSD, Windows 11 Pro, Keyboard & Mouse', category: 'Computers', sku: 'DELL-OPT-7000', unit: 'UNIT', type: ItemType.GOOD, purchasePrice: 2950, sellPrice: 4250, trackQty: true, minStock: 5 },
    { code: 'HW-LENOVO-T14', name: 'Lenovo ThinkPad T14 Laptop', description: '14" FHD, AMD Ryzen 7 / Intel i7, 16GB RAM, 512GB SSD, Windows 11 Pro', category: 'Computers', sku: 'LEN-TP-T14', unit: 'UNIT', type: ItemType.GOOD, purchasePrice: 4100, sellPrice: 5800, trackQty: true, minStock: 4 },
    { code: 'HW-STARLINK-HP', name: 'Starlink High-Performance Satellite Kit', description: 'Commercial motorized satellite terminal, power supply, cables and base mount', category: 'Networking', sku: 'SL-HP-KIT', unit: 'KIT', type: ItemType.GOOD, purchasePrice: 2750, sellPrice: 3650, trackQty: true, minStock: 3 },
    { code: 'HW-UBI-USW24', name: 'Ubiquiti UniFi 24-Port PoE+ Switch', description: '24-port Gigabit switch with PoE+, 2 SFP ports, rackmount managed switch', category: 'Networking', sku: 'UBI-USW-24P', unit: 'UNIT', type: ItemType.GOOD, purchasePrice: 1750, sellPrice: 2450, trackQty: true, minStock: 4 },
    { code: 'HW-UBI-U6PRO', name: 'Ubiquiti UniFi 6 Pro Access Point', description: 'Wi-Fi 6 ceiling/wall indoor/outdoor high-density commercial access point', category: 'Networking', sku: 'UBI-U6-PRO', unit: 'UNIT', type: ItemType.GOOD, purchasePrice: 680, sellPrice: 950, trackQty: true, minStock: 10 },
    { code: 'HW-CAT6-305M', name: 'Cat6 UTP Solid Copper Cable (305m Box)', description: '305m roll Cat6 23AWG 100% bare copper structured networking cable', category: 'Cabling', sku: 'CAB-CAT6-305', unit: 'BOX', type: ItemType.GOOD, purchasePrice: 390, sellPrice: 580, trackQty: true, minStock: 15 },
    { code: 'HW-HIK-4KCAM', name: 'Hikvision 4K IP Weatherproof Camera', description: '8MP 4K Ultra-HD outdoor bullet IP camera with night vision and smart motion', category: 'CCTV', sku: 'HIK-4K-IPCAM', unit: 'UNIT', type: ItemType.GOOD, purchasePrice: 420, sellPrice: 650, trackQty: true, minStock: 12 },
    { code: 'HW-HIK-NVR8P', name: 'Hikvision 8-Channel 4K NVR with 4TB HDD', description: '8-port PoE NVR recorder with pre-installed 4TB surveillance hard drive', category: 'CCTV', sku: 'HIK-NVR-8P', unit: 'UNIT', type: ItemType.GOOD, purchasePrice: 1950, sellPrice: 2800, trackQty: true, minStock: 3 },
    { code: 'HW-APC-1500VA', name: 'APC Smart-UPS 1500VA LCD 230V', description: 'Line-interactive battery backup power supply for servers and networking racks', category: 'Power & UPS', sku: 'APC-SMT-1500', unit: 'UNIT', type: ItemType.GOOD, purchasePrice: 1850, sellPrice: 2650, trackQty: true, minStock: 4 },
    { code: 'LIC-M365-BUS', name: 'Microsoft 365 Business Standard (1-Year CSP)', description: 'Word, Excel, Teams, Outlook, Exchange corporate email and 1TB OneDrive', category: 'Software Licenses', sku: 'MS-M365-BUS', unit: 'USER/YR', type: ItemType.SERVICE, purchasePrice: 540, sellPrice: 720 },
  ];

  for (const itm of items) {
    await prisma.item.upsert({
      where: { code: itm.code },
      update: itm,
      create: itm,
    });
  }

  console.log(`✓ Created ${items.length} Easynet services, business packages & stock hardware items`);

  // ============================================
  // 8. PNG CUSTOMERS
  // ============================================
  const customers = [
    { code: 'CUST-PNG-001', name: 'Kumul Transport & Logistics Ltd', taxId: 'TIN-8912304', phone: '+675 321 4455', email: 'it@kumullogistics.com.pg', paymentTerms: 30, creditLimit: 100000 },
    { code: 'CUST-PNG-002', name: 'Highlands Fresh Agriculture Group', taxId: 'TIN-7761209', phone: '+675 542 1190', email: 'accounts@highlandsfresh.com.pg', paymentTerms: 14, creditLimit: 45000 },
    { code: 'CUST-PNG-003', name: 'Coral Sea Legal & Corporate Advisory', taxId: 'TIN-4458901', phone: '+675 325 8890', email: 'admin@coralsealegal.com.pg', paymentTerms: 30, creditLimit: 60000 },
    { code: 'CUST-PNG-004', name: 'Bismarck Mining Exploration Ltd', taxId: 'TIN-6623091', phone: '+675 422 3344', email: 'supply@bismarckmining.com.pg', paymentTerms: 30, creditLimit: 250000 },
    { code: 'CUST-PNG-005', name: 'Paradise Retailers PNG (Kokopo/POM)', taxId: 'TIN-9901452', phone: '+675 982 7766', email: 'purchasing@paradiseretail.com.pg', paymentTerms: 14, creditLimit: 35000 },
  ];

  for (const c of customers) {
    await prisma.customer.upsert({
      where: { code: c.code },
      update: c,
      create: c,
    });
  }

  console.log(`✓ Created ${customers.length} commercial PNG enterprise customers`);

  // ============================================
  // 9. SUPPLIERS & PARTNERS
  // ============================================
  const suppliers = [
    { code: 'SUP-8N8', name: '8N8 Systems (ERP & Architecture Partner)', taxId: 'TIN-SUP-8N8', phone: '+675 7000 8888', email: 'contracts@8n8systems.com', paymentTerms: 30 },
    { code: 'SUP-STARLINK', name: 'SpaceX Starlink Satellite Services', taxId: 'US-EIN-982341', phone: '+1-800-STARLINK', email: 'enterprise@starlink.com', paymentTerms: 14 },
    { code: 'SUP-PACIFIC-CAB', name: 'Pacific Telecom & Electrical Supplies POM', taxId: 'TIN-3321908', phone: '+675 325 1122', email: 'sales@pacifictelecom.com.pg', paymentTerms: 30 },
    { code: 'SUP-MICROSOFT', name: 'Microsoft Regional Cloud Partner CSP', taxId: 'AU-ABN-441199', phone: '+61-2-9000-1122', email: 'licensing@cspcloud.com.au', paymentTerms: 30 },
    { code: 'SUP-HARDWARE-DIST', name: 'South Pacific IT Distributors (Dell/HP/Ubiquiti)', taxId: 'AU-ABN-882244', phone: '+61-7-3300-4455', email: 'orders@spitdistributors.com.au', paymentTerms: 30 },
  ];

  for (const s of suppliers) {
    await prisma.supplier.upsert({
      where: { code: s.code },
      update: s,
      create: s,
    });
  }

  console.log(`✓ Created ${suppliers.length} local and international technology suppliers`);

  // ============================================
  // 10. ACTIVE CLIENT PROJECTS
  // ============================================
  const projects = [
    {
      code: 'PROJ-POM-HQ',
      name: 'Kumul Logistics Port Moresby HQ Office Network & CCTV',
      description: 'Complete office structured cabling, Wi-Fi 6, Fortinet firewall and 4K CCTV setup for 85 staff',
      customerId: 'CUST-PNG-001',
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-10-31'),
      budget: 85000,
      status: ProjectStatus.ACTIVE,
    },
    {
      code: 'PROJ-MINE-STARLINK',
      name: 'Bismarck Mining Remote Exploration Camp Starlink & Failover',
      description: 'Deployment of dual High-Performance Starlink satellite terminals with local LAN distribution',
      customerId: 'CUST-PNG-004',
      startDate: new Date('2026-08-15'),
      endDate: new Date('2026-09-30'),
      budget: 45000,
      status: ProjectStatus.ACTIVE,
    },
    {
      code: 'PROJ-AGRI-ERP',
      name: 'Highlands Fresh Agriculture ERP & Inventory Automation',
      description: 'Implementation of ERP accounting, purchasing, inventory & POS across Mount Hagen & Goroka depot',
      customerId: 'CUST-PNG-002',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-12-15'),
      budget: 65000,
      status: ProjectStatus.ACTIVE,
    },
  ];

  for (const p of projects) {
    const { customerId, ...pData } = p;
    await prisma.project.upsert({
      where: { code: p.code },
      update: pData,
      create: {
        ...pData,
        customer: { connect: { code: customerId } },
      },
    });
  }

  console.log(`✓ Created ${projects.length} active client engineering & ERP projects`);

  // ============================================
  // 11. PNG EMPLOYEES (IRC SWT & NASFUND)
  // ============================================
  const employees = [
    {
      code: 'EMP-001',
      name: 'Willie Batia',
      email: 'willie.batia@easynet.com.pg',
      phone: '+675 7274 3186',
      department: 'Executive',
      position: 'Director',
      tin: 'TIN-100234',
      nasfundNo: 'NF-100234',
      superFundName: 'Nasfund',
      baseSalary: 4500, // K4,500 fortnightly
      payFrequency: 'FORTNIGHTLY',
      bankName: 'Bank South Pacific (BSP)',
      bankAccountNo: '1001234567',
    },
    {
      code: 'EMP-002',
      name: 'Arka C',
      email: 'arka@easynet.com.pg',
      phone: '+675 7123 9988',
      department: 'Technology',
      position: 'Chief Technology Officer',
      tin: 'TIN-100235',
      nasfundNo: 'NF-100235',
      superFundName: 'Nasfund',
      baseSalary: 4500, // K4,500 fortnightly
      payFrequency: 'FORTNIGHTLY',
      bankName: 'Kina Bank',
      bankAccountNo: '2001234568',
    },
    {
      code: 'EMP-003',
      name: 'Max Giamungi',
      email: 'max.giamungi@easynet.com.pg',
      phone: '+675 7345 1122',
      department: 'Field Operations',
      position: 'IT Field Project Coordinator',
      tin: 'TIN-100236',
      nasfundNo: 'NF-100236',
      superFundName: 'Nasfund',
      baseSalary: 2800, // K2,800 fortnightly
      payFrequency: 'FORTNIGHTLY',
      bankName: 'Bank South Pacific (BSP)',
      bankAccountNo: '1001234569',
    },
    {
      code: 'EMP-004',
      name: 'Kila Auka',
      email: 'kila.auka@easynet.com.pg',
      phone: '+675 7456 2233',
      department: 'Engineering',
      position: 'Senior Systems Consultant',
      tin: 'TIN-100237',
      nasfundNo: 'NF-100237',
      superFundName: 'Nasfund',
      baseSalary: 2500, // K2,500 fortnightly
      payFrequency: 'FORTNIGHTLY',
      bankName: 'Bank South Pacific (BSP)',
      bankAccountNo: '1001234570',
    },
    {
      code: 'EMP-005',
      name: 'Maria Steven',
      email: 'maria.steven@easynet.com.pg',
      phone: '+675 7567 3344',
      department: 'Finance',
      position: 'Accounts Officer',
      tin: 'TIN-100238',
      nasfundNo: 'NF-100238',
      superFundName: 'Nasfund',
      baseSalary: 1600, // K1,600 fortnightly
      payFrequency: 'FORTNIGHTLY',
      bankName: 'Kina Bank',
      bankAccountNo: '2001234571',
    },
  ];

  for (const emp of employees) {
    await prisma.employee.upsert({
      where: { code: emp.code },
      update: emp,
      create: emp,
    });
  }

  console.log(`✓ Created ${employees.length} Easynet PNG employees with Nasfund superannuation`);

  // ============================================
  // 12. GENERAL LEDGER TRANSACTIONS (JOURNAL ENTRIES)
  // ============================================
  await prisma.journalLine.deleteMany({});
  await prisma.journalHeader.deleteMany({});

  const allAccounts = await prisma.chartOfAccounts.findMany({
    select: { id: true, code: true },
  });
  const accountIdByCode = new Map(allAccounts.map((a) => [a.code, a.id]));

  const journalsData = [
    // 1. Opening Balances
    {
      code: 'JRN-2026-OP01',
      date: new Date('2026-01-01'),
      description: 'Opening General Ledger balances & capital establishment',
      reference: 'OP-2026-001',
      sourceDocType: 'OPENING',
      status: JournalStatus.POSTED,
      createdBy: 'willie.batia@easynet.com.pg',
      approvedBy: 'willie.batia@easynet.com.pg',
      postedAt: new Date('2026-01-01T08:00:00Z'),
      lines: [
        { code: '1121', debit: 125000, credit: 0, description: 'BSP Operating Account opening balance' },
        { code: '1122', debit: 35000, credit: 0, description: 'Kina Bank Payroll Account opening balance' },
        { code: '1123', debit: 50000, credit: 0, description: 'Westpac PNG Project Account opening balance' },
        { code: '1124', debit: 57750, credit: 0, description: 'BSP USD Vendor Account (USD $15,000 @ 3.85)' },
        { code: '1111', debit: 2500, credit: 0, description: 'Port Moresby 8 Mile Office petty cash float' },
        { code: '1131', debit: 45000, credit: 0, description: 'Opening trade receivables from enterprise clients' },
        { code: '1141', debit: 38000, credit: 0, description: 'Opening stock - Dell OptiPlex & Lenovo laptops' },
        { code: '1142', debit: 22500, credit: 0, description: 'Opening stock - Ubiquiti UniFi switches & APs' },
        { code: '1144', debit: 18400, credit: 0, description: 'Opening stock - Hikvision 4K cameras & NVRs' },
        { code: '1145', debit: 16500, credit: 0, description: 'Opening stock - Starlink High-Performance kits' },
        { code: '1212', debit: 85000, credit: 0, description: 'Field service support vehicles (Toyota Hilux fleet)' },
        { code: '1211', debit: 35000, credit: 0, description: 'Internal IT infrastructure & staging servers' },
        { code: '2111', debit: 0, credit: 42500, description: 'Opening trade payables to hardware suppliers' },
        { code: '2121', debit: 0, credit: 7000, description: 'Net IRC GST opening liability' },
        { code: '3100', debit: 0, credit: 200000, description: 'Shareholder paid-up equity capital' },
        { code: '3200', debit: 0, credit: 281150, description: 'Retained earnings carried forward' },
      ],
    },
    // 2. Sales Invoice 1: Kumul Logistics
    {
      code: 'INV-2026-0001',
      date: new Date('2026-08-15'),
      description: 'Tax Invoice: Kumul Logistics POM HQ Network & CCTV Phase 1',
      reference: 'INV-2026-0001',
      sourceDocType: 'INVOICE',
      status: JournalStatus.POSTED,
      createdBy: 'sales@easynet.com.pg',
      approvedBy: 'willie.batia@easynet.com.pg',
      postedAt: new Date('2026-08-15T14:00:00Z'),
      lines: [
        { code: '1131', debit: 46750, credit: 0, description: 'Kumul Transport & Logistics Ltd - Total Due' },
        { code: '4220', debit: 0, credit: 35000, description: 'Structured Cat6 Cabling & Wi-Fi setup' },
        { code: '4240', debit: 0, credit: 7500, description: '4K CCTV cameras & NVR installation' },
        { code: '2121', debit: 0, credit: 4250, description: 'IRC 10% GST Output Tax' },
      ],
    },
    // 3. Sales Invoice 2: Highlands Fresh Agriculture
    {
      code: 'INV-2026-0002',
      date: new Date('2026-09-01'),
      description: 'Tax Invoice: Highlands Fresh Agriculture ERP Milestone 1',
      reference: 'INV-2026-0002',
      sourceDocType: 'INVOICE',
      status: JournalStatus.POSTED,
      createdBy: 'sales@easynet.com.pg',
      approvedBy: 'willie.batia@easynet.com.pg',
      postedAt: new Date('2026-09-01T10:00:00Z'),
      lines: [
        { code: '1131', debit: 22000, credit: 0, description: 'Highlands Fresh Agriculture Group - Total Due' },
        { code: '4140', debit: 0, credit: 20000, description: 'ERP deployment, inventory & accounts setup' },
        { code: '2121', debit: 0, credit: 2000, description: 'IRC 10% GST Output Tax' },
      ],
    },
    // 4. Customer Payment Receipt: Kumul Logistics
    {
      code: 'PAY-2026-0001',
      date: new Date('2026-08-28'),
      description: 'Customer Receipt: Kumul Logistics EFT payment for INV-2026-0001',
      reference: 'BSP-EFT-4401',
      sourceDocType: 'PAYMENT',
      status: JournalStatus.POSTED,
      createdBy: 'finance@easynet.com.pg',
      approvedBy: 'finance@easynet.com.pg',
      postedAt: new Date('2026-08-28T16:30:00Z'),
      lines: [
        { code: '1121', debit: 46750, credit: 0, description: 'Funds deposited to BSP Operating Account' },
        { code: '1131', debit: 0, credit: 46750, description: 'Clear Kumul Logistics receivable INV-2026-0001' },
      ],
    },
    // 5. Vendor Bill: South Pacific IT Distributors
    {
      code: 'BILL-2026-0001',
      date: new Date('2026-08-20'),
      description: 'Vendor Bill: UniFi 24P PoE Switches & U6-Pro Access Points',
      reference: 'SPIT-INV-8910',
      sourceDocType: 'BILL',
      status: JournalStatus.POSTED,
      createdBy: 'procurement@easynet.com.pg',
      approvedBy: 'finance@easynet.com.pg',
      postedAt: new Date('2026-08-20T11:00:00Z'),
      lines: [
        { code: '1142', debit: 15000, credit: 0, description: 'UniFi switches & AP stock inventory' },
        { code: '2122', debit: 1500, credit: 0, description: 'IRC 10% GST Input Tax Credit' },
        { code: '2111', debit: 0, credit: 16500, description: 'Payable to South Pacific IT Distributors' },
      ],
    },
    // 6. Vendor Settlement: South Pacific IT Distributors
    {
      code: 'PAY-2026-0002',
      date: new Date('2026-09-02'),
      description: 'Vendor Settlement: South Pacific IT Distributors via BSP TT',
      reference: 'BSP-TT-7702',
      sourceDocType: 'PAYMENT',
      status: JournalStatus.POSTED,
      createdBy: 'finance@easynet.com.pg',
      approvedBy: 'willie.batia@easynet.com.pg',
      postedAt: new Date('2026-09-02T15:00:00Z'),
      lines: [
        { code: '2111', debit: 16500, credit: 0, description: 'Clear vendor bill BILL-2026-0001' },
        { code: '1121', debit: 0, credit: 16500, description: 'Disbursement from BSP Operating Account' },
      ],
    },
    // 7. Fortnightly Payroll Payrun
    {
      code: 'PAY-2026-0003',
      date: new Date('2026-09-05'),
      description: 'Fortnightly Staff Payroll Payrun: Technical, Projects & Admin Staff',
      reference: 'PAY-FN-18-2026',
      sourceDocType: 'PAYROLL',
      status: JournalStatus.POSTED,
      createdBy: 'finance@easynet.com.pg',
      approvedBy: 'willie.batia@easynet.com.pg',
      postedAt: new Date('2026-09-05T17:00:00Z'),
      lines: [
        { code: '6110', debit: 14300, credit: 0, description: 'Gross salaries: Engineers, CTO & Project Coordinator' },
        { code: '6120', debit: 1201.20, credit: 0, description: 'Statutory 8.4% employer Nasfund superannuation' },
        { code: '2124', debit: 0, credit: 2840, description: 'IRC Salary & Wages Tax (SWT) withheld' },
        { code: '2131', debit: 0, credit: 2059.20, description: 'Nasfund total contribution payable (6% emp + 8.4% co)' },
        { code: '1122', debit: 0, credit: 10602, description: 'Net payroll disbursement from Kina Bank' },
      ],
    },
  ];

  for (const j of journalsData) {
    const totalDebit = j.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = j.lines.reduce((s, l) => s + l.credit, 0);

    const createdJournal = await prisma.journalHeader.create({
      data: {
        code: j.code,
        date: j.date,
        description: j.description,
        reference: j.reference,
        sourceDocType: j.sourceDocType,
        status: j.status,
        currency: 'PGK',
        totalDebit,
        totalCredit,
        isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
        createdBy: j.createdBy,
        approvedBy: j.approvedBy,
        postedAt: j.postedAt,
      },
    });

    let lineNo = 1;
    for (const l of j.lines) {
      const accountId = accountIdByCode.get(l.code);
      if (!accountId) {
        console.warn(`⚠️ Warning: Account code ${l.code} not found in chart of accounts!`);
        continue;
      }
      await prisma.journalLine.create({
        data: {
          journalId: createdJournal.id,
          lineNo: lineNo++,
          accountId,
          description: l.description,
          debit: l.debit,
          credit: l.credit,
          amount: Math.max(l.debit, l.credit),
          currency: 'PGK',
        },
      });
    }
  }

  console.log(`✓ Created ${journalsData.length} balanced General Ledger journal vouchers with line postings`);

  console.log('\n======================================================');
  console.log('✅ Easynet IT Solutions Limited database seeding completed!');
  console.log('🏢 Company: Easynet IT Solutions Limited (100% PNG-Owned)');
  console.log('📍 Location: 8 Mile, Gran Eden, Port Moresby, Papua New Guinea');
  console.log('🌐 Website: https://www.easynetpng.com/');
  console.log('💰 Currency: PGK (Papua New Guinea Kina)');
  console.log('📊 Chart of Accounts: Full 6-class hierarchical ledger (1000-6690)');
  console.log('======================================================\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
