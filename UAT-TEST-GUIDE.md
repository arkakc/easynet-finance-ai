# Mini ERP - User Acceptance Testing (UAT) Guide

**Version:** 1.0
**Date:** 2026-09-10
**Prepared for:** UAT Testing Team

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Environment Setup](#environment-setup)
4. [Access & Credentials](#access--credentials)
5. [Test Scenarios by Module](#test-scenarios-by-module)
6. [Test Data Requirements](#test-data-requirements)
7. [Defect Reporting](#defect-reporting)
8. [Sign-off Checklist](#sign-off-checklist)

---

## Overview

This guide provides step-by-step instructions for User Acceptance Testing (UAT) of the Mini ERP system. The system includes:

- **Dashboard** - KPIs and overview
- **Customers** - Customer management
- **Suppliers** - Supplier management
- **Items** - Inventory items
- **Quotes** - Sales quotations
- **Invoices** - Sales invoicing
- **Purchase Orders** - Purchase ordering
- **Supplier Bills** - Purchase invoices
- **Payments** - Customer receipts and supplier payments
- **Expenses** - Expense tracking
- **Journals** - Manual journal entries
- **Accounts** - Chart of Accounts
- **Bank Accounts** - Bank account management
- **Bank Transactions** - Transaction recording
- **Reconciliations** - Bank reconciliation
- **Projects** - Project tracking
- **Reports** - Financial reports
- **Settings** - System configuration
- **Users** - User management

---

## Prerequisites

### System Requirements

- **OS:** Windows 10/11, macOS, or Linux
- **Node.js:** v20.0.0 or higher (v22.x recommended)
- **npm:** v10.x or higher (comes with Node.js)
- **Memory:** Minimum 4GB RAM (8GB recommended)
- **Disk Space:** 500MB free space

### Required Accounts

- **None required** - This is a local installation for UAT testing

---

## Environment Setup

### Step 1: Verify Node.js Installation

Open a terminal/command prompt and verify Node.js is installed:

```bash
node --version
npm --version
```

Expected output:
- Node.js: v20.x.x or higher
- npm: v10.x.x or higher

If not installed, download from: https://nodejs.org/

### Step 2: Navigate to Application Directory

```bash
cd /path/to/easynet-finance-ai
```

Replace `/path/to/easynet-finance-ai` with the actual path where the application is located.

### Step 3: Install Dependencies

```bash
npm install
```

This will install all required packages. Wait for completion - this may take 2-5 minutes depending on internet speed.

### Step 4: Configure Environment

The `.env` file should already be configured for local development:

```env
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="local-dev-secret-change-in-production-min-32-chars"
NEXTAUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
AUTH_SECRET="local-auth-secret-change-in-production-min-32-chars"
```

If the `.env` file doesn't exist, create it by copying `.env.example`:

```bash
cp .env.example .env
```

### Step 5: Set Up Database

The application uses SQLite for local development. Initialize the database:

```bash
npx prisma generate
npx prisma db push
```

This creates the SQLite database file (`prisma/dev.db`) and applies all tables.

### Step 6: Seed Initial Data (Optional)

To populate the database with sample data for testing:

```bash
npx tsx prisma/seed.ts
```

This will create:
- Default chart of accounts
- Sample customers, suppliers
- Sample items
- Test users with different roles

### Step 7: Start the Application

```bash
npm run dev
```

The application will start at: **http://localhost:3000**

Wait for the message: "ready - started server on 0.0.0.0:3000"

### Step 8: Verify Installation

1. Open a web browser
2. Navigate to: http://localhost:3000
3. You should see the login page
4. If you see the login page, installation is successful

---

## Access & Credentials

### Default Test Users

After seeding, the following users are available:

| Role | Email | Password | Description |
|------|-------|----------|-------------|
| System Manager | system@example.com | password123 | Full access to all features |
| Finance Controller | finance@example.com | password123 | Financial reporting, journal entries |
| Accounts User | accounts@example.com | password123 | Accounts payable/receivable |
| Sales User | sales@example.com | password123 | Quotes, invoices, customers |
| Purchase User | purchase@example.com | password123 | POs, bills, suppliers |
| Stock User | stock@example.com | password123 | Inventory management |

**Note:** If you didn't run the seed script, you'll need to register a new user first.

### Register New User (If Not Seeded)

1. Go to http://localhost:3000/login
2. Click "Register" or navigate to registration page
3. Fill in:
   - Name: Your name
   - Email: Your email
   - Password: Choose a password (min 8 characters)
4. Submit registration
5. You'll be logged in automatically

---

## Test Scenarios by Module

For each test scenario, document:
- **Test Case ID:** Unique identifier
- **Description:** What is being tested
- **Pre-conditions:** What must be true before testing
- **Steps:** Step-by-step actions
- **Expected Result:** What should happen
- **Actual Result:** What actually happened
- **Status:** Pass / Fail / Blocked
- **Comments:** Any observations or issues

---

### Module 1: Login & Authentication

#### Test Case: LOGIN-001 - Valid Login
| Field | Details |
|-------|---------|
| **Description** | Verify user can login with valid credentials |
| **Pre-conditions** | User account exists in system |
| **Steps** | 1. Navigate to http://localhost:3000/login<br>2. Enter valid email<br>3. Enter valid password<br>4. Click "Sign In" |
| **Expected Result** | User is logged in and redirected to dashboard |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: LOGIN-002 - Invalid Login
| Field | Details |
|-------|---------|
| **Description** | Verify error message for invalid credentials |
| **Pre-conditions** | None |
| **Steps** | 1. Navigate to login page<br>2. Enter invalid email<br>3. Enter invalid password<br>4. Click "Sign In" |
| **Expected Result** | Error message displayed: "Invalid credentials" |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: LOGIN-003 - Session Persistence
| Field | Details |
|-------|---------|
| **Description** | Verify user remains logged in after browser refresh |
| **Pre-conditions** | User is logged in |
| **Steps** | 1. Login with valid credentials<br>2. Refresh the browser page<br>3. Check if still logged in |
| **Expected Result** | User remains logged in, dashboard displays |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: LOGIN-004 - Logout Functionality
| Field | Details |
|-------|---------|
| **Description** | Verify user can logout successfully |
| **Pre-conditions** | User is logged in |
| **Steps** | 1. Click logout button (usually in header/profile)<br>2. Confirm logout |
| **Expected Result** | User logged out, redirected to login page |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: LOGIN-005 - Role-Based Access
| Field | Details |
|-------|---------|
| **Description** | Verify users can only access features based on their role |
| **Pre-conditions** | Multiple user accounts with different roles exist |
| **Steps** | 1. Login as Sales User<br>2. Try to access Journal entry page<br>3. Login as Finance Controller<br>4. Access Journal entry page |
| **Expected Result** | Sales User cannot access journals; Finance Controller can |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 2: Dashboard

#### Test Case: DASH-001 - Dashboard Loading
| Field | Details |
|-------|---------|
| **Description** | Verify dashboard loads with KPI cards |
| **Pre-conditions** | User is logged in |
| **Steps** | 1. Login to the system<br>2. Navigate to Dashboard (default page) |
| **Expected Result** | Dashboard displays with KPI cards showing metrics |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: DASH-002 - KPI Display
| Field | Details |
|-------|---------|
| **Description** | Verify KPI cards show correct data |
| **Pre-conditions** | Data exists in the system |
| **Steps** | 1. Go to Dashboard<br>2. Check Outstanding Receivables card<br>3. Check Invoices This Month card<br>4. Check other KPI cards |
| **Expected Result** | Each card shows relevant numeric data with labels |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: DASH-003 - Quick Actions
| Field | Details |
|-------|---------|
| **Description** | Verify quick action buttons work |
| **Pre-conditions** | User has appropriate permissions |
| **Steps** | 1. On Dashboard, locate Quick Actions section<br>2. Click "New Invoice" button<br>3. Verify navigation to invoice creation page<br>4. Click other quick action buttons |
| **Expected Result** | Each button navigates to the correct creation page |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: DASH-004 - Top Customers Section
| Field | Details |
|-------|---------|
| **Description** | Verify top customers are displayed |
| **Pre-conditions** | Customers exist in the system |
| **Steps** | 1. Go to Dashboard<br>2. Scroll to Top Customers section |
| **Expected Result** | List of top customers with names and codes displayed |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 3: Customer Management

#### Test Case: CUST-001 - View Customer List
| Field | Details |
|-------|---------|
| **Description** | Verify customer list displays correctly |
| **Pre-conditions** | Customer(s) exist in system |
| **Steps** | 1. Login with appropriate role<br>2. Navigate to Customers (from sidebar)<br>3. Observe the customer list |
| **Expected Result** | Table displays customers with columns: Code, Name, Contact, Terms, Currency, Status, Created, Actions |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: CUST-002 - Search Customers
| Field | Details |
|-------|---------|
| **Description** | Verify customer search functionality |
| **Pre-conditions** | Multiple customers exist |
| **Steps** | 1. Go to Customers list<br>2. Enter search term in search box (e.g., part of name)<br>3. Press Enter or click search icon |
| **Expected Result** | List filters to show matching customers only |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: CUST-003 - Filter by Status
| Field | Details |
|-------|---------|
| **Description** | Verify status filter works |
| **Pre-conditions** | Active and inactive customers exist |
| **Steps** | 1. Go to Customers list<br>2. Select "Active" from status dropdown<br>3. Observe filtered list<br>4. Select "Inactive" from dropdown<br>5. Observe filtered list |
| **Expected Result** | List shows only active customers, then only inactive customers |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: CUST-004 - Create New Customer
| Field | Details |
|-------|---------|
| **Description** | Verify new customer can be created |
| **Pre-conditions** | User has customer creation permission |
| **Steps** | 1. Go to Customers list<br>2. Click "Add Customer" button<br>3. Fill in required fields:<br>   - Name (required)<br>   - Phone (optional)<br>   - Email (optional)<br>   - Payment Terms (default 30)<br>   - Currency (default USD)<br>4. Click "Create" |
| **Expected Result** | Customer created successfully, appears in list, success message shown |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: CUST-005 - Edit Customer
| Field | Details |
|-------|---------|
| **Description** | Verify customer can be edited |
| **Pre-conditions** | Customer exists |
| **Steps** | 1. Go to Customers list<br>2. Find existing customer<br>3. Click edit icon (pencil)<br>4. Modify some fields (e.g., phone number)<br>5. Click "Update" |
| **Expected Result** | Customer updated, changes reflected in list |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: CUST-006 - View Customer Details
| Field | Details |
|-------|---------|
| **Description** | Verify customer details page displays correctly |
| **Pre-conditions** | Customer exists |
| **Steps** | 1. Go to Customers list<br>2. Click on customer's code or view icon<br>3. Observe customer detail page |
| **Expected Result** | Detail page shows customer info, contacts, related records |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: CUST-007 - Delete Customer
| Field | Details |
|-------|---------|
| **Description** | Verify customer can be deleted (if no dependencies) |
| **Pre-conditions** | Customer exists with no invoices/quotes |
| **Steps** | 1. Go to Customers list<br>2. Find customer to delete<br>3. Click delete icon (trash)<br>4. Confirm deletion in prompt |
| **Expected Result** | Customer deleted, removed from list, success message shown |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: CUST-008 - Add Contact to Customer
| Field | Details |
|-------|---------|
| **Description** | Verify contacts can be added to customers |
| **Pre-conditions** | Customer exists |
| **Steps** | 1. Go to Customer detail page<br>2. Locate Contacts section<br>3. Click "Add Contact"<br>4. Fill in: Name (required), Email, Phone, Title<br>5. Click "Add" |
| **Expected Result** | Contact added, appears in contacts list |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: CUST-009 - Pagination
| Field | Details |
|-------|---------|
| **Description** | Verify pagination works correctly |
| **Pre-conditions** | More than 20 customers exist |
| **Steps** | 1. Go to Customers list<br>2. Observe page 1 of results<br>3. Click "Next" or page 2<br>4. Observe page 2 results |
| **Expected Result** | Navigation between pages works, correct records on each page |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 4: Supplier Management

#### Test Case: SUP-001 - View Supplier List
| Field | Details |
|-------|---------|
| **Description** | Verify supplier list displays correctly |
| **Pre-conditions** | Supplier(s) exist in system |
| **Steps** | 1. Login with appropriate role<br>2. Navigate to Suppliers (from sidebar) |
| **Expected Result** | Table displays suppliers with columns similar to customers |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: SUP-002 - Create New Supplier
| Field | Details |
|-------|---------|
| **Description** | Verify new supplier can be created |
| **Pre-conditions** | User has supplier creation permission |
| **Steps** | 1. Go to Suppliers list<br>2. Click "Add Supplier"<br>3. Fill in required fields: Name, Payment Terms, Currency<br>4. Click "Create" |
| **Expected Result** | Supplier created, appears in list |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: SUP-003 - Edit Supplier
| Field | Details |
|-------|---------|
| **Description** | Verify supplier can be edited |
| **Pre-conditions** | Supplier exists |
| **Steps** | 1. Go to Suppliers list<br>2. Click edit icon on supplier<br>3. Modify fields<br>4. Click "Update" |
| **Expected Result** | Supplier updated successfully |
| **Status** | ☐ Pass ☐ Fail |

*(Similar test cases for Search, Filter, View Details, Delete should be created following the Customer pattern)*

---

### Module 5: Item/Inventory Management

#### Test Case: ITEM-001 - View Item List
| Field | Details |
|-------|---------|
| **Description** | Verify item list with stock levels displays |
| **Pre-conditions** | Items exist in system |
| **Steps** | 1. Navigate to Items (or Inventory > Items) |
| **Expected Result** | Table shows items with stock information |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: ITEM-002 - Create New Item
| Field | Details |
|-------|---------|
| **Description** | Verify new item can be created |
| **Pre-conditions** | User has item creation permission |
| **Steps** | 1. Go to Items list<br>2. Click "Add Item"<br>3. Fill in: Name, Type, Unit, Purchase Price, Sell Price<br>4. Click "Create" |
| **Expected Result** | Item created, appears in list |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: ITEM-003 - Track Quantity Flag
| Field | Details |
|-------|---------|
| **Description** | Verify items can be marked for quantity tracking |
| **Pre-conditions** | None |
| **Steps** | 1. Create new item<br>2. Check "Track Quantity" checkbox<br>3. Save item<br>4. View item in list |
| **Expected Result** | Item created with track quantity flag set |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 6: Sales - Quotes

#### Test Case: QT-001 - View Quote List
| Field | Details |
|-------|---------|
| **Description** | Verify quote list displays |
| **Pre-conditions** | Quotes exist or user can create them |
| **Steps** | 1. Navigate to Quotes |
| **Expected Result** | Quotes list displays with status, customer, totals |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: QT-002 - Create Quote
| Field | Details |
|-------|---------|
| **Description** | Verify quote can be created |
| **Pre-conditions** | Customer exists, user has sales permission |
| **Steps** | 1. Go to Quotes<br>2. Click "Create Quote"<br>3. Select Customer<br>4. Add quote lines (description, quantity, unit price)<br>5. Verify totals calculate automatically<br>6. Click "Create" |
| **Expected Result** | Quote created with auto-generated code (e.g., QT-2024-00001) |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: QT-003 - Quote Status Workflow
| Field | Details |
|-------|---------|
| **Description** | Verify quote status can be changed |
| **Pre-conditions** | Quote in Draft status |
| **Steps** | 1. Open a draft quote<br>2. Change status to "Sent"<br>3. Save changes<br>4. Verify status updated |
| **Expected Result** | Quote status changes from Draft to Sent |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 7: Sales - Invoices

#### Test Case: INV-001 - View Invoice List
| Field | Details |
|-------|---------|
| **Description** | Verify invoice list displays |
| **Pre-conditions** | Invoices exist |
| **Steps** | 1. Navigate to Invoices |
| **Expected Result** | Invoices listed with code, customer, status, amounts, due date |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: INV-002 - Create Invoice from Quote
| Field | Details |
|-------|---------|
| **Description** | Verify invoice can be created from quote |
| **Pre-conditions** | Quote exists in Accepted status |
| **Steps** | 1. Go to Quotes<br>2. Find accepted quote<br>3. Click "Convert to Invoice"<br>4. Verify invoice created with quote details |
| **Expected Result** | Invoice created with lines populated from quote |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: INV-003 - Create Invoice Manually
| Field | Details |
|-------|---------|
| **Description** | Verify invoice can be created manually |
| **Pre-conditions** | Customer exists |
| **Steps** | 1. Go to Invoices<br>2. Click "Create Invoice"<br>3. Select Customer<br>4. Add invoice lines<br>5. Verify subtotal, tax, total calculate<br>6. Set due date<br>7. Click "Create" |
| **Expected Result** | Invoice created with auto-generated code (e.g., INV-2024-00001) |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: INV-004 - Invoice Status Change
| Field | Details |
|-------|---------|
| **Description** | Verify invoice status workflow |
| **Pre-conditions** | Invoice in Draft status |
| **Steps** | 1. Open draft invoice<br>2. Change status to "Sent"<br>3. Save<br>4. Later, receive payment<br>5. Change status to "Paid" |
| **Expected Result** | Status changes appropriately through workflow |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: INV-005 - Invoice Outstanding Calculation
| Field | Details |
|-------|---------|
| **Description** | Verify outstanding amount calculates correctly |
| **Pre-conditions** | Invoice created with total amount |
| **Steps** | 1. Create invoice for $1000<br>2. View invoice - outstanding should be $1000<br>3. Record payment of $500<br>4. View invoice - outstanding should be $500 |
| **Expected Result** | Outstanding = Total - Amount Paid |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 8: Purchases - Purchase Orders

#### Test Case: PO-001 - View PO List
| Field | Details |
|-------|---------|
| **Description** | Verify purchase order list displays |
| **Pre-conditions** | POs exist |
| **Steps** | 1. Navigate to Purchase Orders |
| **Expected Result** | POs listed with supplier, status, totals |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: PO-002 - Create Purchase Order
| Field | Details |
|-------|---------|
| **Description** | Verify PO can be created |
| **Pre-conditions** | Supplier exists |
| **Steps** | 1. Go to Purchase Orders<br>2. Click "Create PO"<br>3. Select Supplier<br>4. Add PO lines (item or description, quantity, price)<br>5. Set expected delivery date<br>6. Click "Create" |
| **Expected Result** | PO created with auto-generated code (e.g., PO-2024-00001) |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: PO-003 - PO Status Workflow
| Field | Details |
|-------|---------|
| **Description** | Verify PO status changes correctly |
| **Pre-conditions** | PO in Draft status |
| **Steps** | 1. Change PO status to "Sent"<br>2. Record goods receipt (partial)<br>3. Status should change to "Partially Received"<br>4. Record full receipt<br>5. Status should change to "Received" |
| **Expected Result** | Status progresses through workflow correctly |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 9: Purchases - Supplier Bills

#### Test Case: BILL-001 - View Bills List
| Field | Details |
|-------|---------|
| **Description** | Verify supplier bills list displays |
| **Pre-conditions** | Bills exist |
| **Steps** | 1. Navigate to Supplier Bills |
| **Expected Result** | Bills listed with supplier, status, amounts, due date |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: BILL-002 - Create Supplier Bill
| Field | Details |
|-------|---------|
| **Description** | Verify bill can be created |
| **Pre-conditions** | Supplier exists |
| **Steps** | 1. Go to Supplier Bills<br>2. Click "Create Bill"<br>3. Select Supplier<br>4. Add bill lines<br>5. Set due date<br>6. Click "Create" |
| **Expected Result** | Bill created with auto-generated code (e.g., BILL-2024-00001) |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: BILL-003 - Bill from PO
| Field | Details |
|-------|---------|
| **Description** | Verify bill can be created from PO |
| **Pre-conditions** | PO exists with received goods |
| **Steps** | 1. Open a PO with received goods<br>2. Click "Convert to Bill"<br>3. Verify bill created with PO line details |
| **Expected Result** | Bill created linked to original PO |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 10: Payments

#### Test Case: PAY-001 - Customer Receipt
| Field | Details |
|-------|---------|
| **Description** | Verify customer payment can be recorded |
| **Pre-conditions** | Invoice exists with outstanding amount |
| **Steps** | 1. Go to Payments<br>2. Click "Create Payment"<br>3. Select Type: Customer Receipt<br>4. Select Customer<br>5. Select Invoice (optional - for tracking)<br>6. Enter amount<br>7. Select payment method (Cash, Bank, etc.)<br>8. Click "Create" |
| **Expected Result** | Payment recorded, invoice outstanding updated |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: PAY-002 - Supplier Payment
| Field | Details |
|-------|---------|
| **Description** | Verify supplier payment can be recorded |
| **Pre-conditions** | Bill exists with outstanding amount |
| **Steps** | 1. Go to Payments<br>2. Click "Create Payment"<br>3. Select Type: Supplier Payment<br>4. Select Supplier<br>5. Select Bill (optional)<br>6. Enter amount<br>7. Click "Create" |
| **Expected Result** | Payment recorded, bill outstanding updated |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: PAY-003 - Payment List
| Field | Details |
|-------|---------|
| **Description** | Verify payments list with filtering |
| **Pre-conditions** | Payments exist |
| **Steps** | 1. Go to Payments<br>2. Filter by type (Customer Receipt)<br>3. Filter by customer<br>4. Observe filtered results |
| **Expected Result** | Payments filter correctly by criteria |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 11: Expenses

#### Test Case: EXP-001 - Create Expense
| Field | Details |
|-------|---------|
| **Description** | Verify expense can be recorded |
| **Pre-conditions** | None |
| **Steps** | 1. Go to Expenses<br>2. Click "Create Expense"<br>3. Enter: Date, Category, Description, Amount<br>4. Optionally select Supplier, Project<br>5. Click "Create" |
| **Expected Result** | Expense recorded, total includes tax if applicable |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: EXP-002 - View Expenses List
| Field | Details |
|-------|---------|
| **Description** | Verify expenses list with filtering |
| **Pre-conditions** | Expenses exist |
| **Steps** | 1. Go to Expenses<br>2. Filter by date range<br>3. Filter by category<br>4. Observe filtered results |
| **Expected Result** | Expenses filter correctly |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 12: Journals (Manual Journal Entries)

#### Test Case: JNL-001 - Create Journal Entry
| Field | Details |
|-------|---------|
| **Description** | Verify manual journal entry can be created |
| **Pre-conditions** | Chart of accounts exists |
| **Steps** | 1. Go to Journals<br>2. Click "Create Journal"<br>3. Enter Date, Description<br>4. Add journal lines:<br>   - Select Account<br>   - Enter Debit amount<br>   - Or enter Credit amount<br>5. Ensure total debits = total credits<br>6. Click "Create" |
| **Expected Result** | Journal entry created, balanced (debits = credits) |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: JNL-002 - Journal Must Balance
| Field | Details |
|-------|---------|
| **Description** | Verify system prevents unbalanced journals |
| **Pre-conditions** | None |
| **Steps** | 1. Create journal entry<br>2. Add debit of $100<br>3. Add credit of $50 (not balanced)<br>4. Try to save |
| **Expected Result** | System shows error: "Journal must be balanced" |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: JNL-003 - View Journal List
| Field | Details |
|-------|---------|
| **Description** | Verify journal list displays |
| **Pre-conditions** | Journals exist |
| **Steps** | 1. Go to Journals<br>2. View list of journal entries |
| **Expected Result** | Journals listed with code, date, description, status |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 13: Chart of Accounts

#### Test Case: COA-001 - View Chart of Accounts
| Field | Details |
|-------|---------|
| **Description** | Verify chart of accounts tree view |
| **Pre-conditions** | Accounts exist |
| **Steps** | 1. Navigate to Accounts (Chart of Accounts) |
| **Expected Result** | Accounts displayed in hierarchy (Assets, Liabilities, Equity, Revenue, Expenses) |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: COA-002 - Account Details
| Field | Details |
|-------|---------|
| **Description** | Verify account detail view |
| **Pre-conditions** | Account exists |
| **Steps** | 1. Click on an account in the list<br>2. View account details |
| **Expected Result** | Shows account code, name, type, balance |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 14: Bank Accounts & Transactions

#### Test Case: BANK-001 - Create Bank Account
| Field | Details |
|-------|---------|
| **Description** | Verify bank account can be created |
| **Pre-conditions** | None |
| **Steps** | 1. Go to Bank Accounts<br>2. Click "Add Bank Account"<br>3. Enter: Name, Bank Name, Account Type, Currency<br>4. Optionally enter Opening Balance<br>5. Click "Create" |
| **Expected Result** | Bank account created, appears in list |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: BANK-002 - Record Bank Transaction
| Field | Details |
|-------|---------|
| **Description** | Verify bank transaction can be recorded |
| **Pre-conditions** | Bank account exists |
| **Steps** | 1. Go to Bank Transactions<br>2. Select Bank Account<br>3. Click "Add Transaction"<br>4. Enter: Date, Type (Deposit/Withdrawal), Description, Amount<br>5. Click "Create" |
| **Expected Result** | Transaction recorded against bank account |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 15: Bank Reconciliation

#### Test Case: REC-001 - Create Reconciliation
| Field | Details |
|-------|---------|
| **Description** | Verify bank reconciliation can be performed |
| **Pre-conditions** | Bank account with transactions exists |
| **Steps** | 1. Go to Reconciliations<br>2. Click "Create Reconciliation"<br>3. Select Bank Account<br>4. Enter Period Start and End dates<br>5. Enter Statement Balance (from bank statement)<br>6. Click "Create" |
| **Expected Result** | Reconciliation created showing book balance vs statement balance |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: REC-002 - Reconciliation Difference
| Field | Details |
|-------|---------|
| **Description** | Verify difference is calculated correctly |
| **Pre-conditions** | Reconciliation exists |
| **Steps** | 1. Open a reconciliation<br>2. Check Difference field<br>3. Difference = Statement Balance - Book Balance |
| **Expected Result** | Difference calculated correctly |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 16: Projects

#### Test Case: PROJ-001 - Create Project
| Field | Details |
|-------|---------|
| **Description** | Verify project can be created |
| **Pre-conditions** | Customer exists (optional) |
| **Steps** | 1. Go to Projects<br>2. Click "Create Project"<br>3. Enter: Name, Description, Customer (optional), Budget<br>4. Set status to Planning or Active<br>5. Click "Create" |
| **Expected Result** | Project created with auto-generated code |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: PROJ-002 - View Projects List
| Field | Details |
|-------|---------|
| **Description** | Verify projects list displays |
| **Pre-conditions** | Projects exist |
| **Steps** | 1. Navigate to Projects |
| **Expected Result** | Projects listed with status, customer, budget |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 17: Financial Reports

#### Test Case: RPT-001 - Profit & Loss Report
| Field | Details |
|-------|---------|
| **Description** | Verify P&L report generates correctly |
| **Pre-conditions** | Sales and expenses exist |
| **Steps** | 1. Go to Reports<br>2. Select "Profit & Loss"<br>3. Set date range (optional)<br>4. Click "Generate" |
| **Expected Result** | Report shows Revenue, COGS, Gross Profit, Expenses, Net Profit |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: RPT-002 - Balance Sheet Report
| Field | Details |
|-------|---------|
| **Description** | Verify Balance Sheet generates correctly |
| **Pre-conditions** | Accounting entries exist |
| **Steps** | 1. Go to Reports<br>2. Select "Balance Sheet"<br>3. Click "Generate" |
| **Expected Result** | Report shows Assets = Liabilities + Equity |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: RPT-003 - Aging Report - Receivables
| Field | Details |
|-------|---------|
| **Description** | Verify AR Aging report generates |
| **Pre-conditions** | Outstanding invoices exist |
| **Steps** | 1. Go to Reports<br>2. Select "Aged Receivables"<br>3. Click "Generate" |
| **Expected Result** | Report shows receivables grouped by age buckets (Current, 1-30, 31-60, 61-90, 90+) |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: RPT-004 - Aging Report - Payables
| Field | Details |
|-------|---------|
| **Description** | Verify AP Aging report generates |
| **Pre-conditions** | Outstanding bills exist |
| **Steps** | 1. Go to Reports<br>2. Select "Aged Payables"<br>3. Click "Generate" |
| **Expected Result** | Report shows payables grouped by age buckets |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: RPT-005 - Cash Flow Report
| Field | Details |
|-------|---------|
| **Description** | Verify Cash Flow report generates |
| **Pre-conditions** | Payments exist |
| **Steps** | 1. Go to Reports<br>2. Select "Cash Flow"<br>3. Set date range<br>4. Click "Generate" |
| **Expected Result** | Report shows cash inflows, outflows, net cash flow |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: RPT-006 - Sales Summary Report
| Field | Details |
|-------|---------|
| **Description** | Verify Sales Summary report generates |
| **Pre-conditions** | Invoices exist |
| **Steps** | 1. Go to Reports<br>2. Select "Sales Summary"<br>3. Set date range<br>4. Click "Generate" |
| **Expected Result** | Report shows total revenue, by customer, by status |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: RPT-007 - Purchase Summary Report
| Field | Details |
|-------|---------|
| **Description** | Verify Purchase Summary report generates |
| **Pre-conditions** | Bills exist |
| **Steps** | 1. Go to Reports<br>2. Select "Purchase Summary"<br>3. Set date range<br>4. Click "Generate" |
| **Expected Result** | Report shows total purchases, by supplier, by status |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 18: Settings

#### Test Case: SET-001 - View Global Settings
| Field | Details |
|-------|---------|
| **Description** | Verify settings page displays |
| **Pre-conditions** | User has admin permissions |
| **Steps** | 1. Navigate to Settings |
| **Expected Result** | Settings page shows configurable options |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: SET-002 - Update Settings
| Field | Details |
|-------|---------|
| **Description** | Verify settings can be updated |
| **Pre-conditions** | User has admin permissions |
| **Steps** | 1. Go to Settings<br>2. Modify a setting (e.g., company name)<br>3. Click "Save" |
| **Expected Result** | Setting saved, changes persist |
| **Status** | ☐ Pass ☐ Fail |

---

### Module 19: User Management

#### Test Case: USER-001 - View Users List
| Field | Details |
|-------|---------|
| **Description** | Verify users list displays (admin only) |
| **Pre-conditions** | User logged in as System Manager |
| **Steps** | 1. Navigate to Settings > Users |
| **Expected Result** | List of users with roles, status |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: USER-002 - Create User
| Field | Details |
|-------|---------|
| **Description** | Verify new user can be created (admin only) |
| **Pre-conditions** | User logged in as System Manager |
| **Steps** | 1. Go to Users<br>2. Click "Create User"<br>3. Enter: Name, Email, Password, Role<br>4. Click "Create" |
| **Expected Result** | User created, can login with new credentials |
| **Status** | ☐ Pass ☐ Fail |

#### Test Case: USER-003 - Deactivate User
| Field | Details |
|-------|---------|
| **Description** | Verify user can be deactivated |
| **Pre-conditions** | User exists |
| **Steps** | 1. Go to Users<br>2. Find user to deactivate<br>3. Change status to "Inactive" or "Suspended"<br>4. Save |
| **Expected Result** | User cannot login after deactivation |
| **Status** | ☐ Pass ☐ Fail |

---

## Test Data Requirements

For comprehensive testing, ensure the following test data exists:

### Customers (Minimum 5)
- Customer 1: Active, with multiple invoices
- Customer 2: Active, with outstanding balance
- Customer 3: Active, all invoices paid
- Customer 4: Inactive
- Customer 5: With multiple contacts

### Suppliers (Minimum 3)
- Supplier 1: Active, with outstanding bills
- Supplier 2: Active, all bills paid
- Supplier 3: Active, with multiple POs

### Items (Minimum 5)
- Item 1: Good, track quantity enabled
- Item 2: Service, no quantity tracking
- Item 3: Good, with min/max stock levels
- Item 4: Labor type
- Item 5: Expense type

### Chart of Accounts (Standard structure)
- Assets (1000-1999)
  - Cash at Bank (1000)
  - Accounts Receivable (1100)
  - Inventory (1200)
  - Fixed Assets (1500)
- Liabilities (2000-2999)
  - Accounts Payable (2000)
  - Tax Payable (2100)
- Equity (3000-3999)
  - Owner's Equity (3000)
  - Retained Earnings (3100)
- Revenue (4000-4999)
  - Sales Revenue (4000)
  - Service Revenue (4100)
- Expenses (5000-5999)
  - Cost of Goods Sold (5000)
  - Salaries (5100)
  - Rent (5200)
  - Utilities (5300)

### Transactions for Testing
- 10+ Invoices (mix of paid, partially paid, outstanding)
- 5+ Purchase Orders (mix of statuses)
- 5+ Supplier Bills (mix of paid, outstanding)
- 5+ Customer Receipts
- 3+ Supplier Payments
- 5+ Expenses
- 3+ Manual Journal Entries
- 2+ Bank Accounts
- 10+ Bank Transactions
- 1+ Completed Reconciliation

---

## Defect Reporting

When reporting defects, include:

### Defect Report Template

```
Defect ID: (assigned by tester)
Date: YYYY-MM-DD
Reported By: (tester name)
Severity: Critical / High / Medium / Low
Status: Open / In Progress / Fixed / Closed

Title: (brief summary of issue)

Description:
(detailed description of the problem)

Steps to Reproduce:
1. Step one
2. Step two
3. Step three

Expected Result:
(what should have happened)

Actual Result:
(what actually happened)

Environment:
- Browser: (e.g., Chrome 120)
- OS: (e.g., Windows 11)
- URL: (page where issue occurred)

Screenshot/Video: (attach if available)

Additional Notes:
(any other relevant information)
```

### Severity Levels

- **Critical:** System crash, data loss, security vulnerability, blocking issue
- **High:** Major functionality broken, no workaround available
- **Medium:** Functionality impaired but workaround exists
- **Low:** Cosmetic issue, minor inconvenience

---

## Sign-off Checklist

Before signing off on UAT, verify:

### Critical Path Testing
- [ ] User can login and logout successfully
- [ ] User can create and manage customers
- [ ] User can create and manage suppliers
- [ ] User can create quotes
- [ ] User can convert quote to invoice
- [ ] User can record customer payments
- [ ] User can create purchase orders
- [ ] User can record goods receipt against PO
- [ ] User can create supplier bills
- [ ] User can record supplier payments
- [ ] User can create expenses
- [ ] User can create manual journal entries
- [ ] All financial reports generate correctly
- [ ] Bank reconciliation works

### Data Integrity
- [ ] Invoice totals calculate correctly (subtotal + tax = total)
- [ ] Outstanding amounts calculate correctly (total - paid = outstanding)
- [ ] Journal entries balance (debits = credits)
- [ ] Stock levels update when goods received/sold
- [ ] Customer and supplier codes auto-generate correctly

### Usability
- [ ] Navigation is intuitive
- [ ] Search and filter functions work
- [ ] Pagination works correctly
- [ ] Form validation provides clear error messages
- [ ] Success/error messages are displayed appropriately

### Performance
- [ ] Pages load within acceptable time (2-3 seconds)
- [ ] No major delays when saving data
- [ ] Report generation completes in reasonable time

### Browser Compatibility (if applicable)
- [ ] Tested on Chrome
- [ ] Tested on Firefox (optional)
- [ ] Tested on Edge (optional)

---

## UAT Sign-off

**UAT Completed By:** _______________________
**Date:** _______________________

**Summary:**
- Total Test Cases: ___
- Passed: ___
- Failed: ___
- Blocked: ___
- Not Executed: ___

**Critical Issues:** ___
**High Issues:** ___
**Medium Issues:** ___
**Low Issues:** ___

**Overall Assessment:**
- [ ] Ready for Production
- [ ] Ready with Known Issues (list below)
- [ ] Not Ready - Requires Re-testing

**Known Issues for Production:**
1. 
2. 
3. 

**Sign-off:**

Tester Signature: _______________________ Date: ___________

Project Manager Signature: _______________________ Date: ___________

---

*End of UAT Test Guide*
