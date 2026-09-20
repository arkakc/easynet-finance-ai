import { AccountTypeGL, NormalBalance } from "@prisma/client";

export type StandardCoaRow = {
  code: string;
  name: string;
  type: AccountTypeGL;
  parentCode: string;
  normalBalance: NormalBalance;
  description: string;
};

const dr = NormalBalance.DEBIT;
const cr = NormalBalance.CREDIT;

export function standardCoaRows(companyShortName: string, currency = "PGK"): StandardCoaRow[] {
  const suffix = (companyShortName || "Company").trim();
  return [
    { code: "1000", name: `Application of Funds (Assets) - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "", normalBalance: dr, description: `Asset group for ${suffix}. Currency: ${currency}` },
    { code: "1100", name: `Current Assets - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1000", normalBalance: dr, description: "Short-term operating assets" },
    { code: "1110", name: `Cash in Hand - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1100", normalBalance: dr, description: "Cash control group" },
    { code: "1111", name: `Cash - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1110", normalBalance: dr, description: "Default cash ledger" },
    { code: "1120", name: `Bank Accounts - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1100", normalBalance: dr, description: "Bank account control group" },
    { code: "1121", name: `Bank - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1120", normalBalance: dr, description: "Default operating bank ledger" },
    { code: "1130", name: `Accounts Receivable - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1100", normalBalance: dr, description: "Customer receivable control group" },
    { code: "1131", name: `Debtors - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1130", normalBalance: dr, description: "Default customer outstanding ledger" },
    { code: "1140", name: `Loans and Advances (Assets) - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1100", normalBalance: dr, description: "Employee and third-party advances" },
    { code: "1141", name: `Employee Advances - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1140", normalBalance: dr, description: "Employee advance control ledger" },
    { code: "1150", name: `Securities and Deposits - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1100", normalBalance: dr, description: "Deposit assets" },
    { code: "1151", name: `Earnest Money - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1150", normalBalance: dr, description: "Earnest money and deposits" },
    { code: "1160", name: `Stock Assets - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1100", normalBalance: dr, description: "Inventory asset group" },
    { code: "1161", name: `Stock In Hand - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1160", normalBalance: dr, description: "Default inventory asset ledger" },
    { code: "1162", name: `Tax Assets - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1160", normalBalance: dr, description: "Input tax recoverable assets" },
    { code: "1200", name: `Fixed Assets - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1000", normalBalance: dr, description: "Non-current asset group" },
    { code: "1210", name: `Accumulated Depreciation - ${suffix}`, type: AccountTypeGL.CONTRA_ASSET, parentCode: "1200", normalBalance: cr, description: "Accumulated depreciation contra asset" },
    { code: "1220", name: `Buildings - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1200", normalBalance: dr, description: "Building assets" },
    { code: "1230", name: `CWIP Account - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1200", normalBalance: dr, description: "Capital work in progress" },
    { code: "1240", name: `Capital Equipments - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1200", normalBalance: dr, description: "Capital equipment assets" },
    { code: "1250", name: `Electronic Equipments - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1200", normalBalance: dr, description: "Electronic equipment assets" },
    { code: "1260", name: `Furniture and Fixtures - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1200", normalBalance: dr, description: "Furniture and fixtures" },
    { code: "1270", name: `Office Equipments - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1200", normalBalance: dr, description: "Office equipment assets" },
    { code: "1280", name: `Plants and Machineries - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1200", normalBalance: dr, description: "Plant and machinery assets" },
    { code: "1290", name: `Softwares - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1200", normalBalance: dr, description: "Capitalized software assets" },
    { code: "1300", name: `Investments - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1000", normalBalance: dr, description: "Investment assets" },
    { code: "1400", name: `Temporary Accounts - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1000", normalBalance: dr, description: "Temporary/opening suspense accounts" },
    { code: "1401", name: `Temporary Opening - ${suffix}`, type: AccountTypeGL.ASSET, parentCode: "1400", normalBalance: dr, description: "Temporary opening ledger" },

    { code: "2000", name: `Source of Funds (Liabilities) - ${suffix}`, type: AccountTypeGL.LIABILITY, parentCode: "", normalBalance: cr, description: "Liability group" },
    { code: "2100", name: `Current Liabilities - ${suffix}`, type: AccountTypeGL.LIABILITY, parentCode: "2000", normalBalance: cr, description: "Current liabilities" },
    { code: "2110", name: `Accounts Payable - ${suffix}`, type: AccountTypeGL.LIABILITY, parentCode: "2100", normalBalance: cr, description: "Supplier payable control group" },
    { code: "2111", name: `Creditors - ${suffix}`, type: AccountTypeGL.LIABILITY, parentCode: "2110", normalBalance: cr, description: "Default supplier outstanding ledger" },
    { code: "2120", name: `Payroll Payable - ${suffix}`, type: AccountTypeGL.LIABILITY, parentCode: "2110", normalBalance: cr, description: "Payroll payable control ledger" },
    { code: "2130", name: `Duties and Taxes - ${suffix}`, type: AccountTypeGL.LIABILITY, parentCode: "2100", normalBalance: cr, description: "Tax liability group" },
    { code: "2131", name: `WHT - ${suffix}`, type: AccountTypeGL.LIABILITY, parentCode: "2130", normalBalance: cr, description: "Withholding tax payable" },
    { code: "2140", name: `Loans Liabilities - ${suffix}`, type: AccountTypeGL.LIABILITY, parentCode: "2100", normalBalance: cr, description: "Loan liability group" },
    { code: "2141", name: `Bank Overdraft Account - ${suffix}`, type: AccountTypeGL.LIABILITY, parentCode: "2140", normalBalance: cr, description: "Bank overdraft liability" },
    { code: "2142", name: `Secured Loans - ${suffix}`, type: AccountTypeGL.LIABILITY, parentCode: "2140", normalBalance: cr, description: "Secured loan liabilities" },
    { code: "2143", name: `Unsecured Loans - ${suffix}`, type: AccountTypeGL.LIABILITY, parentCode: "2140", normalBalance: cr, description: "Unsecured loan liabilities" },
    { code: "2150", name: `Stock Liabilities - ${suffix}`, type: AccountTypeGL.LIABILITY, parentCode: "2100", normalBalance: cr, description: "Stock-related liabilities" },
    { code: "2151", name: `Asset Received But Not Billed - ${suffix}`, type: AccountTypeGL.LIABILITY, parentCode: "2150", normalBalance: cr, description: "Asset received not billed control" },
    { code: "2152", name: `Stock Received But Not Billed - ${suffix}`, type: AccountTypeGL.LIABILITY, parentCode: "2150", normalBalance: cr, description: "GRNI / stock received not billed control" },

    { code: "3000", name: `Equity - ${suffix}`, type: AccountTypeGL.EQUITY, parentCode: "", normalBalance: cr, description: "Equity group" },
    { code: "3100", name: `Capital Stock - ${suffix}`, type: AccountTypeGL.EQUITY, parentCode: "3000", normalBalance: cr, description: "Owner/share capital" },
    { code: "3200", name: `Retained Earnings - ${suffix}`, type: AccountTypeGL.EQUITY, parentCode: "3000", normalBalance: cr, description: "Retained earnings control ledger" },
    { code: "3300", name: `Opening Balance Equity - ${suffix}`, type: AccountTypeGL.EQUITY, parentCode: "3000", normalBalance: cr, description: "Opening balance equity" },

    { code: "4000", name: `Income - ${suffix}`, type: AccountTypeGL.REVENUE, parentCode: "", normalBalance: cr, description: "Income group" },
    { code: "4100", name: `Direct Income - ${suffix}`, type: AccountTypeGL.REVENUE, parentCode: "4000", normalBalance: cr, description: "Direct operating income" },
    { code: "4101", name: `Sales - ${suffix}`, type: AccountTypeGL.REVENUE, parentCode: "4100", normalBalance: cr, description: "Default sales income ledger" },
    { code: "4102", name: `Service - ${suffix}`, type: AccountTypeGL.REVENUE, parentCode: "4100", normalBalance: cr, description: "Service income ledger" },
    { code: "4200", name: `Indirect Income - ${suffix}`, type: AccountTypeGL.REVENUE, parentCode: "4000", normalBalance: cr, description: "Indirect income group" },

    { code: "5000", name: `Expenses - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "", normalBalance: dr, description: "Expense group" },
    { code: "5100", name: `Direct Expenses - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5000", normalBalance: dr, description: "Direct expense group" },
    { code: "5110", name: `Stock Expenses - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5100", normalBalance: dr, description: "Stock and valuation expenses" },
    { code: "5111", name: `Cost of Goods Sold - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5110", normalBalance: dr, description: "Default COGS ledger" },
    { code: "5112", name: `Expenses Included In Asset Valuation - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5110", normalBalance: dr, description: "Asset valuation expense clearing" },
    { code: "5113", name: `Expenses Included In Valuation - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5110", normalBalance: dr, description: "Stock valuation expense clearing" },
    { code: "5114", name: `Stock Adjustment - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5110", normalBalance: dr, description: "Stock adjustment/variance ledger" },
    { code: "5200", name: `Direct Purchases - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5100", normalBalance: dr, description: "Direct purchase expense group" },
    { code: "5300", name: `Indirect Expenses - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5000", normalBalance: dr, description: "Indirect expense group" },
    { code: "5301", name: `Administrative Expenses - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5300", normalBalance: dr, description: "Administrative expenses" },
    { code: "5302", name: `Commission on Sales - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5300", normalBalance: dr, description: "Sales commission expenses" },
    { code: "5303", name: `Depreciation - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5300", normalBalance: dr, description: "Depreciation expense ledger" },
    { code: "5304", name: `Entertainment Expenses - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5300", normalBalance: dr, description: "Entertainment expenses" },
    { code: "5305", name: `Exchange Gain/Loss - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5300", normalBalance: dr, description: "Default foreign exchange gain/loss ledger" },
    { code: "5306", name: `Freight and Forwarding Charges - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5300", normalBalance: dr, description: "Freight and forwarding expense" },
    { code: "5307", name: `Gain/Loss on Asset Disposal - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5300", normalBalance: dr, description: "Asset disposal gain/loss ledger" },
    { code: "5308", name: `Round Off - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5300", normalBalance: dr, description: "Default round-off ledger" },
    { code: "5309", name: `Write Off - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5300", normalBalance: dr, description: "Default write-off ledger" },
    { code: "5400", name: `Payroll Expense - ${suffix}`, type: AccountTypeGL.EXPENSE, parentCode: "5000", normalBalance: dr, description: "Payroll expense group" },
  ];
}
