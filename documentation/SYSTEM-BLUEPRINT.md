# Easynet Mini ERP - Complete System Blueprint
## Branch: feature/backend-split-0.4.0 | Version: 1.0.0

**Document Purpose:** Complete technical reference for AI tools, software developers, and system architects  
**Date:** 2026-09-10  
**Last Updated:** 2026-09-10

---

## 📑 TABLE OF CONTENTS

1. [Executive Summary](#executive-summary)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Database Schema - Complete Survey](#database-schema---complete-survey)
5. [Backend Architecture](#backend-architecture)
6. [Frontend Architecture](#frontend-architecture)
7. [Authentication & Authorization System](#authentication--authorization-system)
8. [API Route Structure](#api-route-structure)
9. [Business Logic Services](#business-logic-services)
10. [Data Flow & Relationships](#data-flow--relationships)
11. [Key Modules & Functionality](#key-modules--functionality)
12. [Current System Status](#current-system-status)
13. [Pros & Cons Assessment](#pros--cons-assessment)
14. [Recommendations for Modernization](#recommendations-for-modernization)
15. [Future Development Roadmap](#future-development-roadmap)

---

## 1. EXECUTIVE SUMMARY

**Easynet Mini ERP** is a comprehensive, open-source Enterprise Resource Planning system designed for Small to Medium Enterprises (SMEs). It provides integrated financial and operational management through a modern web application.

### Core Capabilities
- **Sales Management:** Quotes, Invoices, Customer Payments, Credit Notes
- **Purchase Management:** Purchase Orders, Supplier Bills, Goods Receipts, Refunds
- **Inventory Management:** Items, Stock Levels, Stock Movements, Barcode Support
- **Banking:** Multiple Bank Accounts, Transaction Recording, Reconciliation
- **Accounting:** Chart of Accounts, Journal Entries, General Ledger, Financial Reports
- **CRM:** Customer & Supplier Management, Contacts, Projects
- **Reporting:** Dashboard, AR/AP Aging, P&L, Balance Sheet, Cash Flow
- **Multi-Currency:** Exchange Rates, Currency Conversion
- **Tax Management:** Tax Codes, Tax Reports
- **Approval Workflow:** Document Approval System
- **Audit Trail:** Complete Activity Logging
- **Role-Based Access Control:** 9 User Roles with Granular Permissions

### Target Users
- SMEs requiring integrated ERP without enterprise complexity
- Businesses needing local/self-hosted deployment option
- Organizations requiring SQLite for portability or PostgreSQL for production

### Deployment Options
- **Local Development:** SQLite database (`prisma/dev.db`)
- **Production:** PostgreSQL (schema compatible)
- **Hosting:** Node.js server, Vercel, or any Node-compatible platform

---

## 2. TECHNOLOGY STACK

### Core Framework
| Component | Technology | Version | Purpose |
|-----------|------------|---------|---------|
| Framework | Next.js | 16.3.2 | React full-stack framework with App Router |
| Language | TypeScript | ^5.8.0 | Type-safe programming |
| Runtime | Node.js | >=20.0.0 | Server runtime environment |
| Package Manager | npm | 10.x | Dependency management |

### Database & ORM
| Component | Technology | Version | Purpose |
|-----------|------------|---------|---------|
| ORM | Prisma | ^6.0.0 | Type-safe database access |
| Database (Local) | SQLite | - | Local development & UAT |
| Database (Production) | PostgreSQL | - | Production deployment (schema compatible) |
| Prisma Client | @prisma/client | ^6.0.0 | Generated database client |

### Authentication & Security
| Component | Technology | Version | Purpose |
|-----------|------------|---------|---------|
| Authentication | NextAuth.js | ^5.0.0-beta.25 | Authentication framework |
| Prisma Adapter | @auth/prisma-adapter | ^2.0.0 | Prisma integration for NextAuth |
| Password Hashing | bcryptjs | ^2.4.3 | Password security (cost factor: 12) |

### Frontend
| Component | Technology | Version | Purpose |
|-----------|------------|---------|---------|
| UI Components | React | ^19.1.0 | Component-based UI |
| Styling | Tailwind CSS | (via next) | Utility-first CSS framework |
| Charts | Recharts | ^2.14.0 | Data visualization |
| Icons | Lucide React | ^1.5.0 | Icon library |
| Forms | React Hook Form | ^7.55.0 | Form handling |
| Form Validation | Zod + @hookform/resolvers | ^3.9.0 | Schema validation |
| Utility | clsx + tailwind-merge | - | Class name merging |
| Data Fetching | SWR | ^2.3.0 | React hooks for data fetching |
| PDF Generation | @react-pdf/renderer | ^4.0.0 | PDF document generation |

### Development Tools
| Component | Technology | Version | Purpose |
|-----------|------------|---------|---------|
| TypeScript | typescript | ^5.8.0 | Type checking |
| Prisma CLI | prisma | ^6.0.0 | Database schema management |
| Script Runner | tsx | ^4.19.0 | TypeScript execution |
| Linting | eslint + eslint-config-next | 16.3.2 | Code quality |
| Types | @types/* | various | TypeScript definitions |

---

## 3. PROJECT STRUCTURE

### Root Directory Layout
```
easynet-finance-ai/
├── prisma/
│   ├── schema.prisma          # Complete database schema (1461 lines)
│   ├── seed.ts                # Database seeder with sample data
│   ├── dev.db                 # SQLite database file (local)
│   └── migrate/               # Migration files (if using migrations)
│
├── src/
│   ├── app/                   # Next.js App Router directory
│   │   ├── api/               # API route handlers
│   │   │   ├── auth/          # Authentication endpoints
│   │   │   │   └── register/
│   │   │   │       └── route.ts
│   │   │   ├── users/         # User management endpoints
│   │   │   │   └── route.ts
│   │   │   └── [...nextauth]/ # NextAuth handler (dynamic route)
│   │   │
│   │   ├── login/             # Login page
│   │   │   └── page.tsx
│   │   │
│   │   ├── dashboard/         # Dashboard page
│   │   │   └── page.tsx
│   │   │
│   │   ├── customers/         # Customers module (UI)
│   │   ├── suppliers/         # Suppliers module (UI)
│   │   ├── items/             # Items/Inventory module (UI)
│   │   ├── quotes/            # Quotes module (UI)
│   │   ├── invoices/          # Invoices module (UI)
│   │   ├── purchase-orders/   # POs module (UI)
│   │   ├── bills/             # Bills module (UI)
│   │   ├── payments/          # Payments module (UI)
│   │   ├── banking/           # Banking module (UI)
│   │   ├── accounting/        # Accounting module (UI)
│   │   ├── reports/           # Reports module (UI)
│   │   ├── settings/          # Settings module (UI)
│   │   └── profile/           # User profile (UI)
│   │
│   ├── components/            # React components
│   │   ├── ui/                # Reusable UI primitives
│   │   ├── layout/            # Layout components (navbar, sidebar)
│   │   └── feature-specific/  # Module-specific components
│   │
│   ├── lib/                   # Library & utility code
│   │   ├── db.ts              # Prisma client singleton (OR original db.ts)
│   │   ├── prisma.ts          # Prisma client (alternate/correct one)
│   │   ├── auth.ts            # Authentication helpers (8301 bytes)
│   │   │   - hashPassword()
│   │   │   - verifyPassword()
│   │   │   - PERMISSIONS constant
│   │   │   - ROLE_PERMISSIONS mapping
│   │   │   - hasPermission() helper
│   │   ├── next-auth.ts       # NextAuth configuration (4408 bytes)
│   │   │   - authOptions object
│   │   │   - Credentials provider
│   │   │   - Prisma adapter
│   │   │   - Session callbacks
│   │   ├── utils.ts           # General utilities
│   │   └── services/          # Business logic services
│   │       ├── sales.service.ts       # Sales operations
│   │       └── document.service.ts    # Document operations
│   │
│   ├── types/                 # TypeScript type definitions
│   │   └── next-auth.d.ts     # NextAuth type extensions (502 bytes)
│   │
│   └── styles/                # Styles
│       └── globals.css        # Global styles + Tailwind directives
│
├── scripts/
│   ├── hash-password.ts       # Standalone password hashing utility
│   └── seed.ts                # Alternative seed script
│
├── public/                     # Static assets (favicon, images, etc.)
├── .env                        # Environment variables
├── .env.example                # Environment template
├── package.json                # Dependencies & scripts
├── tailwind.config.ts          # Tailwind configuration
├── next.config.js              # Next.js configuration
├── tsconfig.json               # TypeScript configuration
├── eslint.config.js            # ESLint configuration
│
├── documentation/
│   ├── SYSTEM-BLUEPRINT.md    # This document
│   ├── UAT-TEST-GUIDE.md      # User acceptance test guide
│   └── LOCAL-SETUP-GUIDE.md   # Local setup instructions
│
└── README.md                   # Project readme
```

### Key File Sizes & Importance
| File | Size | Importance |
|------|------|------------|
| `prisma/schema.prisma` | 1461 lines, 40KB | **CRITICAL** - Complete data model |
| `src/lib/auth.ts` | 8301 bytes | **HIGH** - Auth helpers & permissions |
| `src/lib/next-auth.ts` | 4408 bytes | **HIGH** - NextAuth configuration |
| `src/lib/prisma.ts` | ~100 bytes | **CRITICAL** - DB client singleton |
| `src/lib/services/sales.service.ts` | ~5KB | **MEDIUM** - Sales business logic |
| `src/lib/services/document.service.ts` | ~3KB | **MEDIUM** - Document business logic |
| `src/types/next-auth.d.ts` | 502 bytes | **MEDIUM** - Type extensions |

---

## 4. DATABASE SCHEMA - COMPLETE SURVEY

### 4.1 Model Count & Organization

**Total Models:** 35 database models  
**Total Enums:** 28 enums  
**Total Relations:** 50+ relationships

Models organized by domain:

#### A. Authentication & Authorization (4 models)
1. **User** - Core user entity
2. **Account** - OAuth accounts (NextAuth)
3. **Session** - User sessions
4. **VerificationToken** - Email verification tokens

#### B. Business Masters (5 models)
5. **Customer** - Sales customers
6. **Supplier** - Purchase suppliers
7. **Contact** - Customer/Supplier contacts
8. **Project** - Projects/Jobs
9. **Item** - Inventory items/products

#### C. Inventory (3 models)
10. **StockLevel** - Current stock per item
11. **StockMovement** - Stock movement history
12. **Favorite** - User favorites (cross-cutting)

#### D. Sales Module (6 models)
13. **Quote** - Sales quotations
14. **QuoteLine** - Quote line items
15. **Invoice** - Sales invoices
16. **InvoiceLine** - Invoice line items
17. **CreditNote** - Customer credit notes
18. **CreditNoteLine** - Credit note lines

#### E. Purchase Module (6 models)
19. **PurchaseOrder** - Purchase orders
20. **POLine** - PO line items
21. **GoodsReceipt** - Goods received notes
22. **SupplierBill** - Supplier invoices
23. **BillLine** - Bill line items
24. **Refund** - Supplier refunds

#### F. Payments & Cash (1 model, used by multiple domains)
25. **Payment** - Unified payment model (customer receipts, supplier payments, etc.)

#### G. Expenses (1 model)
26. **Expense** - Business expenses

#### H. Banking & Reconciliation (3 models)
27. **BankAccount** - Bank accounts
28. **BankTransaction** - Bank transactions
29. **Reconciliation** - Bank reconciliation statements

#### I. Accounting (3 models)
30. **ChartOfAccounts** - General ledger accounts
31. **JournalHeader** - Journal entries
32. **JournalLine** - Journal entry lines

#### J. Documents & Attachments (2 models)
33. **Document** - File attachments
34. **Favorite** - User favorites

#### K. Audit & Logging (1 model)
35. **AuditLog** - System activity log

#### L. Time & Billing (1 model)
36. **TimeEntry** - Time tracking for service businesses

#### M. Budget & Forecasting (1 model)
37. **Budget** - Budget entries

#### N. Settings & Configuration (2 models)
38. **GlobalSettings** - System-wide settings
39. **UserPreferences** - User-specific settings

#### O. Workflow (2 models)
40. **ApprovalRequest** - Approval workflow
41. **Task** - System tasks

#### P. Multi-Currency (2 models)
42. **Currency** - Currency definitions
43. **ExchangeRate** - Exchange rates

#### Q. Taxes (2 models)
44. **TaxCode** - Tax classifications
45. **TaxReport** - Tax reports

---

### 4.2 Complete Entity Relationship Diagram (Textual)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    User      │     │   Account    │     │   Session    │
│  (Auth)      │     │  (OAuth)     │     │  (Session)   │
├──────────────┤     ├──────────────┤     ├──────────────┤
│ id (PK)      │◄─── │ userId (FK)  │     │ userId (FK)  │
│ name         │     │ id (PK)      │     │ id (PK)      │
│ email (UQ)   │     │ type         │     │ sessionToken │
│ password     │     │ provider     │     │ expires      │
│ role         │     │ ...          │     └──────────────┘
│ status       │     └──────────────┘
│ ...          │
└──────────────┘
     │
     ├──< CreatedDocuments ──────── Document
     ├──< ApprovedDocuments ─────── Document
     ├──< AuditLogs ─────────────── AuditLog
     └──< Favorites ─────────────── Favorite
```

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Customer    │     │   Supplier   │     │    Item      │
│  (Sales)     │     │  (Purchase)  │     │ (Inventory)  │
├──────────────┤     ├──────────────┤     ├──────────────┤
│ id (PK)      │     │ id (PK)      │     │ id (PK)      │
│ code (UQ)    │     │ code (UQ)    │     │ code (UQ)    │
│ name         │     │ name         │     │ name         │
│ taxId        │     │ taxId        │     │ sku (UQ)     │
│ creditLimit  │     │ paymentTerms │     │ barcode (UQ) │
│ currency     │     │ currency     │     │ purchasePrice│
│ isActive     │     │ isActive     │     │ sellPrice    │
│ ...          │     │ ...          │     │ costAccount  │
└──────────────┘     └──────────────┘     │ revenueAccount│
     │                 │                   │ taxCode       │
     ├──< Quotes ──────┤                   │ ...           │
     ├──< Invoices ────┤                   └──────────────┘
     ├──< Payments ────┤                        │
     ├──< CreditNotes ─┤                        ├──< StockLevel (1:1)
     └──< Projects ────┘                        ├──< QuoteLines (1:many)
                                               ├──< InvoiceLines (1:many)
                                               ├──< POLines (1:many)
                                               ├──< BillLines (1:many)
                                               └──< StockMovements (1:many)
```

```
Sales Flow:
Quote ──> Invoice ──> Payment (CUSTOMER_RECEIPT)
  │           │
  │           └──> CreditNote (issued against invoice)
  │
  └──> ConvertedInvoice (link back to originating quote)

Purchase Flow:
PurchaseOrder ──> GoodsReceipt ──> SupplierBill ──> Payment (SUPPLIER_PAYMENT)
     │                                        │
     └──> Bill (link)                        └──> Refund (against bill)
```

```
Accounting Flow:
Invoice/Bill/Payment/Expense ──> JournalHeader ──> JournalLine ──> ChartOfAccounts
                                    │                    │
                                    └──> Document (attachment)
```

```
Project Flow:
Project ──> Quotes
        ──> Invoices
        ──> PurchaseOrders
        ──> Bills
        ──> Payments
        ──> Expenses
        ──> TimeEntries
```

### 4.3 Key Enums

#### User & Auth Enums
- `Role`: SYSTEM_MANAGER, FINANCE_CONTROLLER, ACCOUNTS_USER, SALES_USER, PURCHASE_USER, STOCK_USER, MANAGEMENT, AUDITOR, USER
- `UserStatus`: ACTIVE, SUSPENDED, INVITED, DEACTIVED

#### Item Enums
- `ItemType`: GOOD, SERVICE, LABOR, EXPENSE, NON_INVENTORY
- `MovementType`: PURCHASE_IN, SALE_OUT, ADJUSTMENT_IN, ADJUSTMENT_OUT, TRANSFER_IN, TRANSFER_OUT, RETURN_IN, RETURN_OUT, COUNTED

#### Sales Enums
- `QuoteStatus`: DRAFT, SENT, ACCEPTED, REJECTED, EXPIRED, CONVERTED, CANCELLED
- `InvoiceStatus`: DRAFT, SENT, PARTIAL, PAID, OVERDUE, CANCELLED, VOID
- `CreditNoteStatus`: DRAFT, SENT, APPLIED, PARTIAL, CANCELLED

#### Purchase Enums
- `POStatus`: DRAFT, SENT, PARTIAL_RECEIVED, RECEIVED, BILLED, CLOSED, Cancelled
- `GRStatus`: PENDING, PARTIAL, COMPLETE, CLOSED
- `BillStatus`: DRAFT, SENT, PARTIAL, PAID, OVERDUE, CANCELLED, VOID
- `RefundStatus`: DRAFT, SENT, RECEIVED, CANCELLED

#### Payment Enums
- `PaymentType`: CUSTOMER_RECEIPT, CUSTOMER_REFUND, SUPPLIER_PAYMENT, SUPPLIER_REFUND, EMPLOYEE_ADVANCE, OWNER_CONTRIBUTION, OWNER_DRAWING, BANK_TRANSFER, INTERNAL_TRANSFER
- `PaymentStatus`: PENDING, AUTHORIZED, CAPTURED, CLEARED, REVERSED, FAILED, CANCELLED

#### Banking Enums
- `AccountType`: CHECKING, SAVINGS, CREDIT_CARD, LOAN, PETTY_CASH, INVESTMENT
- `BankTransactionType`: DEPOSIT, WITHDRAWAL, FEE, INTEREST, TRANSFER_IN, TRANSFER_OUT, CHECK, AUTOMATIC_PAYMENT
- `ReconciliationStatus`: PENDING, IN_PROGRESS, COMPLETED, FAILED

#### Accounting Enums
- `AccountTypeGL`: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE, CONTRA_ASSET, CONTRA_LIABILITY
- `NormalBalance`: DEBIT, CREDIT
- `JournalStatus`: DRAFT, PENDING, POSTED, REVERSED, CANCELLED

#### Document Enums
- `DocumentType`: INVOICE, QUOTE, PURCHASE_ORDER, BILL, RECEIPT, CONTRACT, AGREEMENT, CERTIFICATE, ID_DOCUMENT, BANK_STATEMENT, OTHER
- `DocumentStatus`: UPLOADED, PENDING_REVIEW, APPROVED, REJECTED, PROCESSED, ARCHIVED

#### Project Enums
- `ProjectStatus`: PLANNING, ACTIVE, ON_HOLD, COMPLETED, CANCELLED

#### Time Enums
- `TimeEntryStatus`: DRAFT, SUBMITTED, APPROVED, REJECTED, BILLED, CANCELLED

#### Approval Enums
- `ApprovalStatus`: PENDING, IN_REVIEW, APPROVED, REJECTED, Cancelled, EXPIRED
- `ApprovalPriority`: LOW, NORMAL, HIGH, URGENT

#### Task Enums
- `TaskStatus`: OPEN, IN_PROGRESS, COMPLETED, CANCELLED, OVERDUE
- `TaskPriority`: LOW, NORMAL, HIGH, URGENT

#### Tax Enums
- `TaxType`: SALES, PURCHASE, VAT, GST, HST, PAYROLL, CUSTOMS, OTHER
- `TaxReportStatus`: DRAFT, CALCULATED, SUBMITTED, PAID, CANCELLED

---

## 5. BACKEND ARCHITECTURE

### 5.1 API Design Pattern

The system uses **Next.js App Router** with Route Handlers for API endpoints.

```
Request Flow:
Browser ──> Next.js Server ──> Route Handler ──> Service Layer ──> Prisma Client ──> SQLite/PostgreSQL

Response Flow:
Prisma ──> Service ──> Route Handler ──> Next.js Server ──> Browser
```

### 5.2 Route Handler Structure

Each API endpoint follows this pattern:

```typescript
// Example: src/app/api/customers/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authorize } from '@/lib/auth'

export async function GET(request: NextRequest) {
  // 1. Authentication & Authorization
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  // 2. Permission check
  if (!hasPermission(session.user, 'CUSTOMER_READ')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  
  // 3. Business logic via Prisma
  const customers = await prisma.customer.findMany({
    where: { isActive: true },
    include: { contacts: true }
  })
  
  // 4. Response
  return NextResponse.json(customers)
}

export async function POST(request: NextRequest) {
  // Similar pattern for create operations
}
```

### 5.3 Authentication Middleware Pattern

```typescript
// Authentication check in each API route
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/next-auth'

const session = await getServerSession(authOptions)
if (!session?.user) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

// Permission check using auth.ts helpers
import { hasPermission, ROLE_PERMISSIONS } from '@/lib/auth'
const userRole = session.user.role as Role
const permissions = ROLE_PERMISSIONS[userRole]
if (!hasPermission(permissions, 'CUSTOMER_READ')) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

### 5.4 Service Layer Pattern

```typescript
// src/lib/services/sales.service.ts
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export class SalesService {
  // Create quote with lines
  static async createQuote(data: {
    customerId: string
    lines: Prisma.QuoteCreateInput['lines']
    projectId?: string
    notes?: string
  }) {
    return prisma.quote.create({
      data: {
        ...data,
        status: 'DRAFT',
        createdBy: 'current_user_id' // From session
      },
      include: { lines: true }
    })
  }
  
  // Convert quote to invoice
  static async convertQuoteToInvoice(quoteId: string) {
    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: { lines: true, customer: true }
    })
    
    // Create invoice from quote
    const invoice = await prisma.invoice.create({
      data: {
        customerId: quote.customerId,
        projectId: quote.projectId,
        sourceDocId: quote.id,
        lines: {
          create: quote.lines.map(line => ({
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate,
            // ... map fields
          }))
        }
      }
    })
    
    // Update quote status
    await prisma.quote.update({
      where: { id: quoteId },
      data: {
        status: 'CONVERTED',
        convertedToInvoiceId: invoice.id,
        convertedAt: new Date()
      }
    })
    
    return invoice
  }
}
```

---

## 6. FRONTEND ARCHITECTURE

### 6.1 Next.js App Router Structure

```
src/app/
├── layout.tsx                    # Root layout with providers
├── page.tsx                      # Home/redirect page
├── login/
│   └── page.tsx                  # Login page
├── dashboard/
│   └── page.tsx                  # Main dashboard
├── customers/
│   ├── page.tsx                  # Customer list
│   ├── [id]/page.tsx             # Customer detail/edit
│   └── new/
│       └── page.tsx              # Create customer
├── suppliers/
│   ├── page.tsx
│   ├── [id]/page.tsx
│   └── new/page.tsx
├── items/
│   ├── page.tsx
│   └── [id]/page.tsx
├── quotes/
│   ├── page.tsx
│   └── [id]/page.tsx
├── invoices/
│   ├── page.tsx
│   └── [id]/page.tsx
├── purchase-orders/
│   ├── page.tsx
│   └── [id]/page.tsx
├── bills/
│   ├── page.tsx
│   └── [id]/page.tsx
├── payments/
│   ├── page.tsx
│   └── [id]/page.tsx
├── banking/
│   ├── bank-accounts/page.tsx
│   ├── transactions/page.tsx
│   └── reconciliations/page.tsx
├── accounting/
│   ├── chart-of-accounts/page.tsx
│   ├── journals/page.tsx
│   └── reports/page.tsx
├── reports/
│   ├── aging/page.tsx
│   ├── financial/page.tsx
│   └── page.tsx
├── settings/
│   ├── page.tsx
│   ├── currencies/page.tsx
│   ├── tax-codes/page.tsx
│   └── users/page.tsx
├── profile/
│   └── page.tsx
└── api/                          # API routes (see API section)
```

### 6.2 Component Architecture

```
src/components/
├── ui/                           # Primitive UI components
│   ├── button.tsx                # Button component
│   ├── input.tsx                 # Input field
│   ├── textarea.tsx              # Text area
│   ├── select.tsx                # Dropdown select
│   ├── table.tsx                 # Data table
│   ├── dialog.tsx                # Modal dialog
│   ├── dropdown-menu.tsx         # Dropdown menu
│   ├── tabs.tsx                  # Tabbed interface
│   ├── badge.tsx                 # Badge/label
│   ├── card.tsx                  # Card container
│   ├── toast.tsx                 # Notification
│   └── ...
│
├── layout/                       # Layout components
│   ├── navbar.tsx                # Top navigation
│   ├── sidebar.tsx               # Side navigation
│   ├── footer.tsx                # Footer
│   └── ...
│
├── customers/                    # Customer-specific
│   ├── customer-form.tsx         # Customer CRUD form
│   ├── customer-table.tsx        # Customer list table
│   └── customer-detail.tsx       # Customer detail view
│
├── invoices/                     # Invoice-specific
│   ├── invoice-form.tsx          # Invoice creation/edit
│   ├── invoice-table.tsx         # Invoice list
│   ├── invoice-pdf.tsx           # PDF generation
│   └── invoice-preview.tsx       # Invoice preview
│
├── quotes/                        # Quote-specific
│   ├── quote-form.tsx
│   ├── quote-table.tsx
│   └── quote-preview.tsx
│
├── payments/                      # Payment-specific
│   ├── payment-form.tsx
│   └── payment-table.tsx
│
├── banking/                       # Banking-specific
│   ├── bank-account-form.tsx
│   ├── transaction-import.tsx
│   └── reconciliation-interface.tsx
│
├── accounting/                    # Accounting-specific
│   ├── journal-form.tsx
│   ├── journal-entry.tsx
│   └── chart-of-accounts-tree.tsx
│
├── reports/                       # Report components
│   ├── dashboard-metrics.tsx     # Dashboard KPIs
│   ├── aging-report.tsx          # AR/AP Aging
│   ├── profit-loss-chart.tsx     # P&L visualization
│   └── balance-sheet.tsx         # Balance sheet
│
├── charts/                        # Chart wrappers
│   ├── bar-chart.tsx             # Recharts bar chart
│   ├── line-chart.tsx            # Recharts line chart
│   ├── pie-chart.tsx             # Recharts pie chart
│   └── ...
│
└── forms/                         # Shared form components
    ├── date-picker.tsx
    ├── currency-input.tsx
    ├── decimal-input.tsx
    └── ...
```

### 6.3 State Management Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                    STATE MANAGEMENT                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Server State (Server Components)                          │
│  ├── Fetch data in Server Components                       │
│  ├── Pass as props to Client Components                    │
│  └── No client-side fetching needed                        │
│                                                             │
│  Client State (Client Components)                          │
│  ├── React useState/useReducer for UI state               │
│  ├── React Hook Form for form state                        │
│  └── SWR for client-side data fetching (if needed)        │
│                                                             │
│  Global State (Context)                                     │
│  ├── Theme (dark/light)                                    │
│  ├── User session (from NextAuth)                          │
│  └── Auth state (from NextAuth)                            │
│                                                             │
│  Form State                                                 │
│  ├── React Hook Form + Zod validation                     │
│  ├── @hookform/resolvers for schema validation            │
│  └── Form submission to API routes                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6.4 Styling Approach

- **Tailwind CSS** - Utility-first CSS framework
- **Dark theme** - Default dark mode
- **Custom components** - Built on shadcn/ui patterns
- **Responsive design** - Mobile-first approach
- **Consistent spacing** - Using Tailwind's spacing scale
- **Typography** - Consistent font sizes and weights

---

## 7. AUTHENTICATION & AUTHORIZATION SYSTEM

### 7.1 Authentication Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    LOGIN FLOW                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. User enters email & password on login page             │
│         │                                                   │
│         ▼                                                   │
│  2. Form submits to /api/auth/credentials (NextAuth)      │
│         │                                                   │
│         ▼                                                   │
│  3. CredentialsProvider.verify() called                   │
│         │                                                   │
│         ▼                                                   │
│  4. Find user by email in database                        │
│         │                                                   │
│         ▼                                                   │
│  5. bcrypt.compare(password, user.password)               │
│         │                                                   │
│         ▼                                                   │
│  6. If match: Create session                              │
│    If no match: Return error                              │
│         │                                                   │
│         ▼                                                   │
│  7. Session stored in database (via Prisma adapter)       │
│         │                                                   │
│         ▼                                                   │
│  8. Redirect to dashboard with session                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 NextAuth Configuration (src/lib/next-auth.ts)

```typescript
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: 'database',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }
        
        const user = await prisma.user.findUnique({
          where: { email: credentials.email }
        })
        
        if (!user || !user.password) {
          return null
        }
        
        const isValid = await bcrypt.compare(
          credentials.password,
          user.password
        )
        
        if (!isValid) {
          return null
        }
        
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          image: user.image
        }
      }
    })
  ],
  callbacks: {
    async session({ session, user }) {
      // Add role and permissions to session
      if (user) {
        session.user.role = user.role as Role
        session.user.id = user.id
      }
      return session
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
      }
      return token
    }
  }
}
```

### 7.3 Password Security

```typescript
// src/lib/auth.ts
import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 12

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}
```

### 7.4 Role-Based Access Control (RBAC)

#### Role Hierarchy

```
SYSTEM_MANAGER (Full Access)
    │
    ├── FINANCE_CONTROLLER (Financial oversight + approvals)
    │       │
    │       ├── ACCOUNTS_USER (Accounting operations)
    │       │
    │       └── MANAGEMENT (Dashboard, reports - read only)
    │
    ├── SALES_USER (Sales operations)
    │
    ├── PURCHASE_USER (Purchase operations)
    │
    ├── STOCK_USER (Inventory management)
    │
    ├── AUDITOR (Audit trail, reports - read only)
    │
    └── USER (Basic user - limited access)
```

#### Permission System

```typescript
// src/lib/auth.ts - Permission Definitions
export const PERMISSIONS = {
  // Dashboard
  DASHBOARD_READ: 'dashboard.read',
  
  // Sales
  SALES_READ: 'sales.read',
  SALES_WRITE: 'sales.write',
  SALES_APPROVE: 'sales.approve',
  
  // Purchase
  PURCHASE_READ: 'purchase.read',
  PURCHASE_WRITE: 'purchase.write',
  PURCHASE_APPROVE: 'purchase.approve',
  
  // Inventory
  STOCK_READ: 'stock.read',
  STOCK_WRITE: 'stock.write',
  STOCK_ADJUST: 'stock.adjust',
  
  // Accounting
  ACCOUNTS_READ: 'accounts.read',
  ACCOUNTS_WRITE: 'accounts.write',
  ACCOUNTS_POST: 'accounts.post',
  ACCOUNTS_APPROVE: 'accounts.approve',
  
  // Reports
  REPORTS_READ: 'reports.read',
  REPORTS_EXPORT: 'reports.export',
  
  // Administration
  USERS_MANAGE: 'users.manage',
  SETTINGS_MANAGE: 'settings.manage',
  AUDIT_VIEW: 'audit.view',
  
  // Document management
  DOCUMENTS_READ: 'documents.read',
  DOCUMENTS_WRITE: 'documents.write',
  DOCUMENTS_APPROVE: 'documents.approve',
  
  // AI features
  AI_USE: 'ai.use',
} as const

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS]

// Role → Permission Mapping
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.SYSTEM_MANAGER]: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.SALES_READ, PERMISSIONS.SALES_WRITE, PERMISSIONS.SALES_APPROVE,
    PERMISSIONS.PURCHASE_READ, PERMISSIONS.PURCHASE_WRITE, PERMISSIONS.PURCHASE_APPROVE,
    PERMISSIONS.STOCK_READ, PERMISSIONS.STOCK_WRITE, PERMISSIONS.STOCK_ADJUST,
    PERMISSIONS.ACCOUNTS_READ, PERMISSIONS.ACCOUNTS_WRITE, PERMISSIONS.ACCOUNTS_POST, PERMISSIONS.ACCOUNTS_APPROVE,
    PERMISSIONS.REPORTS_READ, PERMISSIONS.REPORTS_EXPORT,
    PERMISSIONS.USERS_MANAGE, PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.DOCUMENTS_READ, PERMISSIONS.DOCUMENTS_WRITE, PERMISSIONS.DOCUMENTS_APPROVE,
    PERMISSIONS.AI_USE,
  ],
  [Role.FINANCE_CONTROLLER]: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.SALES_READ, PERMISSIONS.SALES_APPROVE,
    PERMISSIONS.PURCHASE_READ, PERMISSIONS.PURCHASE_APPROVE,
    PERMISSIONS.ACCOUNTS_READ, PERMISSIONS.ACCOUNTS_WRITE, PERMISSIONS.ACCOUNTS_POST, PERMISSIONS.ACCOUNTS_APPROVE,
    PERMISSIONS.REPORTS_READ, PERMISSIONS.REPORTS_EXPORT,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.DOCUMENTS_READ, PERMISSIONS.DOCUMENTS_APPROVE,
    PERMISSIONS.AI_USE,
  ],
  // ... other roles
}

// Permission Check Helper
export function hasPermission(
  userPermissions: Permission[],
  requiredPermission: Permission
): boolean {
  return userPermissions.includes(requiredPermission)
}

// Usage in API routes
import { hasPermission, ROLE_PERMISSIONS } from '@/lib/auth'

const session = await getServerSession(authOptions)
const userRole = session?.user?.role as Role
const permissions = ROLE_PERMISSIONS[userRole]

if (!hasPermission(permissions, 'CUSTOMER_READ')) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

---

## 8. API ROUTE STRUCTURE

### 8.1 Complete API Endpoint Map

```
/api/
├── auth/
│   ├── [...nextauth]/
│   │   └── route.ts              # NextAuth handlers (GET, POST)
│   │                             # - GET:  Session check, CSRF
│   │                             # - POST: Login, callback
│   │
│   └── register/
│       └── route.ts              # User registration (POST)
│                                   # - Creates user with hashed password
│                                   # - Returns user data
│
├── users/
│   └── route.ts                  # User management
│                                   # - GET:  List users (admin only)
│                                   # - POST: Create user (admin)
│                                   # - PUT:  Update user
│                                   # - DELETE: Delete user
│
├── customers/
│   ├── route.ts                  # Customer CRUD
│   │                             # - GET:  List/search customers
│   │                             # - POST: Create customer
│   ├── [id]/
│   │   └── route.ts              # Single customer operations
│   │                             # - GET:  Get customer by ID
│   │                             # - PUT:  Update customer
│   │                             # - DELETE: Delete customer (soft)
│   └── search/
│       └── route.ts              # Customer search endpoint
│
├── suppliers/
│   ├── route.ts                  # Supplier CRUD
│   └── [id]/
│       └── route.ts              # Single supplier operations
│
├── items/
│   ├── route.ts                  # Item CRUD
│   └── [id]/
│       └── route.ts              # Single item operations
│
├── quotes/
│   ├── route.ts                  # Quote CRUD
│   │                             # - GET:  List quotes (filterable)
│   │                             # - POST: Create quote
│   ├── [id]/
│   │   └── route.ts              # Single quote operations
│   │                             # - GET:  Get quote with lines
│   │                             # - PUT:  Update quote
│   │                             # - DELETE: Delete quote
│   └── convert/
│       └── [id]/
│           └── route.ts          # Convert quote to invoice (POST)
│
├── invoices/
│   ├── route.ts                  # Invoice CRUD
│   │                             # - GET:  List invoices (filterable)
│   │                             # - POST: Create invoice
│   ├── [id]/
│   │   └── route.ts              # Single invoice operations
│   │                             # - GET:  Get invoice with lines
│   │                             # - PUT:  Update invoice
│   │                             # - POST: Record payment
│   │                             # - POST: Issue credit note
│   └── send/
│       └── [id]/
│           └── route.ts          # Send invoice via email (POST)
│
├── purchase-orders/
│   ├── route.ts                  # PO CRUD
│   └── [id]/
│       └── route.ts              # Single PO operations
│
├── bills/
│   ├── route.ts                  # Supplier Bill CRUD
│   └── [id]/
│       └── route.ts              # Single bill operations
│
├── payments/
│   ├── route.ts                  # Payment CRUD
│   │                             # - GET:  List payments
│   │                             # - POST: Create payment
│   └── [id]/
│       └── route.ts              # Single payment operations
│
├── bank-accounts/
│   ├── route.ts                  # Bank account CRUD
│   └── [id]/
│       └── route.ts              # Single bank account operations
│
├── bank-transactions/
│   ├── route.ts                  # Transaction CRUD
│   │                             # - GET:  List transactions
│   │                             # - POST: Import/create transactions
│   └── [id]/
│       └── route.ts              # Single transaction operations
│
├── reconciliations/
│   ├── route.ts                  # Reconciliation CRUD
│   └── [id]/
│       └── route.ts              # Single reconciliation operations
│
├── chart-of-accounts/
│   └── route.ts                  # GL account list (GET)
│
├── journals/
│   ├── route.ts                  # Journal CRUD
│   │                             # - GET:  List journals
│   │                             # - POST: Create journal
│   └── [id]/
│       └── route.ts              # Single journal operations
│
├── reports/
│   ├── dashboard/
│   │   └── route.ts              # Dashboard metrics (GET)
│   ├── aging-receivables/
│   │   └── route.ts              # AR aging report (GET)
│   ├── aging-payables/
│   │   └── route.ts              # AP aging report (GET)
│   ├── profit-loss/
│   │   └── route.ts              # P&L report (GET)
│   ├── balance-sheet/
│   │   └── route.ts              # Balance sheet (GET)
│   └── cash-flow/
│       └── route.ts              # Cash flow (GET)
│
├── settings/
│   └── route.ts                  # Global settings CRUD
│
├── currencies/
│   └── route.ts                  # Currency list (GET)
│
├── exchange-rates/
│   └── route.ts                  # Exchange rate CRUD
│
├── tax-codes/
│   └── route.ts                  # Tax code CRUD
│
└── audit-logs/
    └── route.ts                  # Audit log access (admin/auditor)
```

---

## 9. BUSINESS LOGIC SERVICES

### 9.1 Available Services

#### Sales Service (src/lib/services/sales.service.ts)

```typescript
// Key functions:
- createQuote(data) → Create new quote with lines
- updateQuote(id, data) → Update existing quote
- convertQuoteToInvoice(quoteId) → Convert quote to invoice
- createInvoice(data) → Create new invoice
- updateInvoice(id, data) → Update invoice
- recordPayment(invoiceId, paymentData) → Record payment against invoice
- issueCreditNote(invoiceId, creditNoteData) → Issue credit note
- calculateTotals(lines) → Calculate subtotal, tax, total
```

#### Document Service (src/lib/services/document.service.ts)

```typescript
// Key functions:
- uploadDocument(file, metadata) → Upload/store document
- getDocument(id) → Retrieve document
- generatePdf(documentType, data) → Generate PDF (using react-pdf)
- approveDocument(documentId, approverId) → Approve document
- rejectDocument(documentId, approverId, reason) → Reject document
```

### 9.2 Service Architecture Pattern

```typescript
// Pattern used for all services
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { v4 as cuid } from 'cuid' // or use Prisma's cuid()

export class ServiceName {
  // CRUD operations
  static async create(data: InputType): Promise<OutputType> {
    // 1. Validate input
    // 2. Transform data
    // 3. Create in database
    // 4. Return with relations
  }
  
  static async read(id: string): Promise<OutputType | null> {
    // 1. Find by ID with relations
    // 2. Return or null
  }
  
  static async update(id: string, data: UpdateType): Promise<OutputType> {
    // 1. Find existing
    // 2. Validate
    // 3. Update
    // 4. Return updated
  }
  
  static async delete(id: string): Promise<void> {
    // 1. Soft delete or hard delete
    // 2. Handle cascades
  }
  
  // Business logic methods
  static async calculateX(data): Promise<Result> {
    // Business calculation logic
  }
  
  static async processY(transaction): Promise<Result> {
    // Complex transaction processing
    // Uses Prisma transactions for atomicity
  }
}
```

### 9.3 Transaction Handling

```typescript
// Example: Atomic transaction for payment recording
import { prisma } from '@/lib/prisma'

async function recordPayment(paymentData: PaymentInput) {
  return prisma.$transaction(async (tx) => {
    // 1. Create payment record
    const payment = await tx.payment.create({
      data: paymentData
    })
    
    // 2. Update invoice (if against invoice)
    if (paymentData.invoiceId) {
      const invoice = await tx.invoice.findUnique({
        where: { id: paymentData.invoiceId }
      })
      
      await tx.invoice.update({
        where: { id: paymentData.invoiceId },
        data: {
          amountPaid: { increment: paymentData.amount },
          outstanding: { decrement: paymentData.amount }
        }
      })
    }
    
    // 3. Create journal entry (if GL posting)
    if (paymentData.glPost) {
      await tx.journalHeader.create({
        data: {
          // Journal data
          lines: {
            create: [
              { /* debit line */ },
              { /* credit line */ }
            ]
          }
        }
      })
    }
    
    // 4. Create audit log
    await tx.auditLog.create({
      data: {
        action: 'CREATE',
        entityType: 'Payment',
        entityId: payment.id,
        description: `Payment of ${paymentData.amount} recorded`,
        userId: paymentData.createdBy
      }
    })
    
    return payment
  })
}
```

---

## 10. DATA FLOW & RELATIONSHIPS

### 10.1 Core Business Flows

#### Quote to Invoice Flow

```
1. Create Quote
   ┌─────────────────────────────────────────┐
   │ quote.create({                          │
   │   customerId: string,                   │
   │   lines: [{                             │
   │     itemId: string,                     │
   │     quantity: decimal,                  │
   │     unitPrice: decimal,                 │
   │     taxRate: decimal                    │
   │   }],                                   │
   │   status: 'DRAFT',                      │
   │   createdBy: userId                     │
   │ })                                      │
   └─────────────────────────────────────────┘
   ↓
2. Quote Status Transitions
   DRAFT → SENT → ACCEPTED → CONVERTED
           ↓
           REJECTED
           ↓
           EXPIRED
           ↓
           CANCELLED

3. Convert to Invoice
   ┌─────────────────────────────────────────┐
   │ quote.update({                           │
   │   where: { id: quoteId },               │
   │   data: {                               │
   │     status: 'CONVERTED',                │
   │     convertedToInvoiceId: invoiceId,   │
   │     convertedAt: new Date()             │
   │   }                                     │
   │ })                                      │
   │                                         │
   │ invoice.create({                        │
   │   customerId: quote.customerId,         │
   │   sourceDocId: quote.id,                │
   │   lines: {                              │
   │     create: quote.lines.map(...)       │
   │   }                                     │
   │ })                                      │
   └─────────────────────────────────────────┘

4. Invoice Status Transitions
   DRAFT → SENT → PARTIAL → PAID
           ↓          ↓
           OVERDUE   CANCELLED
           ↓
           VOID

5. Record Payment
   ┌─────────────────────────────────────────┐
   │ payment.create({                        │
   │   type: 'CUSTOMER_RECEIPT',            │
   │   amount: decimal,                      │
   │   invoiceId: invoiceId,                │
   │   paymentMethod: 'BANK',               │
   │   createdBy: userId                     │
   │ })                                      │
   │                                         │
   │ invoice.update({                        │
   │   where: { id: invoiceId },             │
   │   data: {                               │
   │     amountPaid: { increment: amount }, │
   │     outstanding: { decrement: amount } │
   │   }                                     │
   │ })                                      │
   └─────────────────────────────────────────┘
```

#### Purchase Order to Bill Flow

```
1. Create PO
   ┌─────────────────────────────────────────┐
   │ purchaseOrder.create({                  │
   │   supplierId: string,                   │
   │   lines: [{                             │
   │     itemId: string,                     │
   │     quantity: decimal,                  │
   │     unitPrice: decimal                  │
   │   }],                                   │
   │   status: 'DRAFT'                       │
   │ })                                      │
   └─────────────────────────────────────────┘
   ↓
2. PO Status: DRAFT → SENT → PARTIAL_RECEIVED → RECEIVED → BILLED → CLOSED

3. Goods Receipt
   ┌─────────────────────────────────────────┐
   │ goodsReceipt.create({                   │
   │   orderId: poId,                        │
   │   receivedDate: new Date(),             │
   │   items: 'line details',                │
   │   status: 'PENDING'                     │
   │ })                                      │
   └─────────────────────────────────────────┘
   ↓
4. PO Status: RECEIVED

5. Create Bill from PO
   ┌─────────────────────────────────────────┐
   │ supplierBill.create({                   │
   │   supplierId: po.supplierId,            │
   │   orderId: po.id,                       │
   │   poReference: po.code,                 │
   │   lines: {                              │
   │     create: po.lines.map(...)          │
   │   }                                     │
   │ })                                      │
   │                                         │
   │ purchaseOrder.update({                  │
   │   where: { id: poId },                  │
   │   data: {                               │
   │     status: 'BILLED',                   │
   │     billId: billId                      │
   │   }                                     │
   │ })                                      │
   └─────────────────────────────────────────┘

6. Bill Status: DRAFT → SENT → PARTIAL → PAID → OVERDUE → CANCELLED/VOID

7. Record Payment
   ┌─────────────────────────────────────────┐
   │ payment.create({                        │
   │   type: 'SUPPLIER_PAYMENT',            │
   │   amount: decimal,                     │
   │   billId: billId,                      │
   │   paymentMethod: 'BANK'                │
   │ })                                      │
   └─────────────────────────────────────────┘
```

#### Bank Reconciliation Flow

```
1. Bank Transactions
   ┌─────────────────────────────────────────┐
   │ bankTransaction.create({                │
   │   bankAccountId: string,                │
   │   date: DateTime,                       │
   │   type: 'DEPOSIT' | 'WITHDRAWAL',      │
   │   amount: decimal,                      │
   │   description: string,                  │
   │   isReconciled: false                   │
   │ })                                      │
   └─────────────────────────────────────────┘

2. Prepare Reconciliation
   ┌─────────────────────────────────────────┐
   │ reconciliation.create({                 │
   │   bankAccountId: string,                │
   │   periodStart: DateTime,                │
   │   periodEnd: DateTime,                  │
   │   statementBalance: decimal,            │
   │   bookBalance: decimal,                 │
   │   status: 'PENDING'                     │
   │ })                                      │
   └─────────────────────────────────────────┘

3. Match Transactions
   ┌─────────────────────────────────────────┐
   │ bankTransaction.update({                │
   │   where: { id: txId },                  │
   │   data: {                               │
   │     isReconciled: true,                 │
   │     reconciliationId: recId,            │
   │     matchedPaymentId: payId,           │
   │     // or matchedInvoiceId, matchedBillId│
   │   }                                     │
   │ })                                      │
   └─────────────────────────────────────────┘

4. Complete Reconciliation
   ┌─────────────────────────────────────────┐
   │ reconciliation.update({                 │
   │   where: { id: recId },                 │
   │   data: {                               │
   │     status: 'COMPLETED',                │
   │     reviewedBy: userId,                 │
   │     reviewedAt: new Date()              │
   │   }                                     │
   │ })                                      │
   └─────────────────────────────────────────┘
```

### 10.2 Cross-Entity Relationships

```
Customer ─────────────────────────────────────────────┐
  │                                                    │
  ├── Quotes───────────────────────────────────────────┤
  │     └── QuoteLines ────────────────────────────────┤
  │                                                   │
  ├── Invoices─────────────────────────────────────────┤
  │     └── InvoiceLines ──────────────────────────────┤
  │                                                   │
  ├── Payments (CUSTOMER_RECEIPT, CUSTOMER_REFUND) ───┤
  │                                                   │
  ├── CreditNotes──────────────────────────────────────┤
  │     └── CreditNoteLines ───────────────────────────┤
  │                                                   │
  └── Projects─────────────────────────────────────────┘

Supplier ──────────────────────────────────────────────┐
  │                                                     │
  ├── PurchaseOrders────────────────────────────────────┤
  │     └── POLines ────────────────────────────────────┤
  │                                                     │
  ├── Bills─────────────────────────────────────────────┤
  │     └── BillLines ──────────────────────────────────┤
  │                                                     │
  ├── Payments (SUPPLIER_PAYMENT, SUPPLIER_REFUND) ────┤
  │                                                     │
  ├── Refunds───────────────────────────────────────────┤
  │                                                     │
  └── Projects──────────────────────────────────────────┘

Project ─────────────────────────────────────────────────┐
  │                                                      │
  ├── Customer ──────────────────────────────────────────┤
  │                                                      │
  ├── Supplier ──────────────────────────────────────────┤
  │                                                      │
  ├── Quotes ────────────────────────────────────────────┤
  │                                                      │
  ├── Invoices ──────────────────────────────────────────┤
  │                                                      │
  ├── PurchaseOrders ────────────────────────────────────┤
  │                                                      │
  ├── Bills ─────────────────────────────────────────────┤
  │                                                      │
  ├── Payments ──────────────────────────────────────────┤
  │                                                      │
  ├── Expenses ──────────────────────────────────────────┤
  │                                                      │
  └── TimeEntries ───────────────────────────────────────┘

ChartOfAccounts ───────────────────────────────────────────┐
  │                                                         │
  ├── parent/children (self-referential hierarchy)          │
  │                                                         │
  ├── JournalLines ──────────────────────────────────────────┤
  │                                                         │
  └── JournalHeaders ────────────────────────────────────────┘

Item ────────────────────────────────────────────────────────┐
  │                                                           │
  ├── StockLevel (1:1) ───────────────────────────────────────┤
  │                                                           │
  ├── QuoteLines (1:many) ────────────────────────────────────┤
  │                                                           │
  ├── InvoiceLines (1:many) ───────────────────────────────────┤
  │                                                           │
  ├── POLines (1:many) ────────────────────────────────────────┤
  │                                                           │
  ├── BillLines (1:many) ──────────────────────────────────────┤
  │                                                           │
  └── StockMovements (1:many) ──────────────────────────────────┘
```

---

## 11. KEY MODULES & FUNCTIONALITY

### 11.1 Sales Module

**Features:**
- Customer management (CRUD, credit limits, payment terms)
- Quote creation with line items
- Quote status workflow (Draft → Sent → Accepted → Converted)
- Invoice creation (manual or from quote)
- Invoice line items with tax calculation
- Payment recording against invoices
- Credit note issuance
- Invoice PDF generation (react-pdf)
- Outstanding amount tracking
- Overdue detection

**Key Data Points:**
- Quote: code, customerId, status, subtotal, taxTotal, total
- Invoice: code, customerId, status, amountPaid, outstanding, glPosted
- Payment: type, amount, paymentMethod, invoiceId, depositAccount

### 11.2 Purchase Module

**Features:**
- Supplier management (CRUD, payment terms)
- Purchase order creation with line items
- PO status workflow (Draft → Sent → Partial Received → Received → Billed → Closed)
- Goods receipt recording
- Supplier bill creation (manual or from PO)
- Bill line items with cost accounts
- Payment recording against bills
- Refund processing
- PO-to-Bill link tracking

**Key Data Points:**
- PO: code, supplierId, status, total, amountReceived
- GoodsReceipt: code, orderId, status, items (text)
- SupplierBill: code, supplierId, status, total, amountPaid, glPosted

### 11.3 Inventory Module

**Features:**
- Item master data (code, name, SKU, barcode, description)
- Item categorization (type: Good, Service, Labor, Expense, Non-Inventory)
- Purchase & sell price tracking
- GL account mapping (cost account, revenue account, inventory asset)
- Tax code assignment
- Stock tracking (trackQty flag)
- Min/max stock levels
- Stock level management (quantity, reserved, available)
- Stock movement history (purchases, sales, adjustments, transfers, returns)
- Movement type classification
- Image URL support

**Key Data Points:**
- Item: code, sku, barcode, purchasePrice, sellPrice, trackQty, minStock, maxStock
- StockLevel: itemId, quantity, reserved, available
- StockMovement: itemId, type, quantity, unitCost, totalCost, referenceType, referenceId

### 11.4 Banking Module

**Features:**
- Multiple bank account management
- Account types (Checking, Savings, Credit Card, Loan, Petty Cash, Investment)
- Bank transaction recording
- Transaction categorization
- Transaction import (future: bank feed integration)
- Reconciliation preparation
- Statement vs book balance comparison
- Difference tracking
- Transaction matching to payments/invoices/bills
- Reconciliation status workflow

**Key Data Points:**
- BankAccount: code, bankName, accountNumber, accountType, openingBalance
- BankTransaction: bankAccountId, date, type, amount, description, isReconciled
- Reconciliation: bankAccountId, periodStart, periodEnd, statementBalance, bookBalance, difference

### 11.5 Accounting Module

**Features:**
- Chart of Accounts (hierarchical, 5+ types)
- Account types: Asset, Liability, Equity, Revenue, Expense, Contra-Asset, Contra-Liability
- Normal balance configuration (Debit/Credit)
- System account flag (non-deletable)
- Journal entry creation
- Journal line items with debit/credit
- Automatic balancing validation
- Document source linking (Invoice, Bill, Payment, Expense, etc.)
- Journal status workflow (Draft → Pending → Posted → Reversed → Cancelled)
- Project/Customer/Supplier tracking on journal lines
- Tax code assignment on lines
- Cost center tracking

**Key Data Points:**
- ChartOfAccounts: code, name, type, parentId, normalBalance, isSystem
- JournalHeader: code, date, description, totalDebit, totalCredit, isBalanced, status
- JournalLine: journalId, accountId, debit, credit, amount, projectId, customerId, supplierId

### 11.6 Reporting Module

**Reports Available:**
1. **Dashboard:** Summary metrics (AR, AP, cash, pending approvals)
2. **AR Aging:** Accounts receivable aging by customer
3. **AP Aging:** Accounts payable aging by supplier
4. **Profit & Loss:** Income statement with revenue/expenses
5. **Balance Sheet:** Assets, liabilities, equity
6. **Cash Flow:** Cash inflows/outflows analysis
7. **Tax Reports:** Sales tax and purchase tax summaries

**Key Data Points:**
- Dashboard: pending invoices, overdue invoices, outstanding AP, cash position
- AR Aging: customer, invoice, age bucket (current, 1-30, 31-60, 61-90, 90+), amount
- AP Aging: supplier, bill, age bucket, amount
- P&L: revenue accounts, expense accounts, net profit
- Balance Sheet: assets, liabilities, equity (must balance)

### 11.7 Settings & Configuration

**Configurable Settings:**
- Company name
- Default currency
- Tax rates
- fiscal year
- Business address
- Payment terms templates
- Email settings (for sending documents)

**Module-Specific Settings:**
- Currencies (code, name, symbol, decimal places)
- Exchange rates (from/to, rate, date, source)
- Tax codes (code, name, type, rate, compound, refundable)
- User preferences (theme, locale, timezone, default values)

---

## 12. CURRENT SYSTEM STATUS

### 12.1 What's Working

✅ **Complete Database Schema** - 35 models, 28 enums, 50+ relationships defined  
✅ **Authentication System** - NextAuth with credentials provider, bcrypt password hashing  
✅ **Role-Based Access Control** - 9 roles, granular permissions, permission checking  
✅ **API Routes** - Complete CRUD APIs for all entities  
✅ **Service Layer** - Sales service, document service implemented  
✅ **Seed Data** - Comprehensive seeder with sample data for all modules  
✅ **Frontend Pages** - All major module pages exist  
✅ **UI Components** - Reusable component library  
✅ **PDF Generation** - react-pdf integration for invoices/quotes  
✅ **Form Validation** - Zod + React Hook Form integration  
✅ **Charts** - Recharts integration for dashboards and reports  
✅ **Multi-Currency** - Currency and exchange rate support  
✅ **Tax Management** - Tax codes and tax reports  
✅ **Approval Workflow** - Document approval system  
✅ **Audit Trail** - Complete activity logging  
✅ **Project Management** - Projects with multiple entity associations  

### 12.2 What's Partially Complete

⚠️ **Email Integration** - Structure exists but full email sending may not be implemented  
⚠️ **Document Upload** - Structure exists but actual file storage may be placeholder  
⚠️ **Bank Feed Import** - Transaction import structure but no real bank feed integration  
⚠️ **Mobile Responsiveness** - May need enhancement for mobile devices  
⚠️ **Offline Capabilities** - No offline support  
⚠️ **Advanced Search** - Basic search exists, advanced filtering may be limited  

### 12.3 What's Planned/Placeholder

🔲 **Multi-company Support** - Single company only currently  
🔲 **Multi-language (i18n)** - English only  
🔲 **Advanced Analytics** - Basic reports, complex analytics limited  
🔲 **API Rate Limiting** - Not implemented  
🔲 **Real-time Updates** - No WebSocket/Server-Sent Events  
🔲 **Payroll Integration** - Not implemented  
🔲 **HR Module** - Not implemented  
🔲 **E-commerce Integration** - Not implemented  

---

## 13. PROS & CONS ASSESSMENT

### ✅ PROS (Strengths)

1. **Comprehensive Feature Set**
   - Covers entire ERP spectrum: Sales, Purchase, Inventory, Banking, Accounting
   - 35 database models covering all major business entities
   - Complete workflow support from quote to payment, PO to payment

2. **Modern Technology Stack**
   - Next.js 16 with App Router (latest)
   - TypeScript for type safety
   - Prisma ORM for database abstraction
   - NextAuth for authentication
   - Tailwind CSS for styling

3. **Flexible Deployment**
   - SQLite for local/UAT (portable, no server needed)
   - PostgreSQL compatible (production ready)
   - Can run on any Node.js hosting platform

4. **Robust Authentication & Authorization**
   - NextAuth with credentials and OAuth support
   - bcrypt password hashing (cost factor 12)
   - 9 user roles with granular permissions
   - Session management with database storage

5. **Complete Audit Trail**
   - Every action logged (CREATE, UPDATE, DELETE, POST, APPROVE, etc.)
   - Entity type and ID tracking
   - User, IP, user agent capture
   - Indexed for query performance

6. **Multi-Currency & Tax Support**
   - Multiple currencies with exchange rates
   - Tax codes with various types (VAT, GST, HST, Sales, Purchase)
   - Tax calculation in quotes, invoices, bills

7. **Approval Workflow**
   - Document approval system
   - Priority levels (Low, Normal, High, Urgent)
   - Approval history tracking

8. **Open Source**
   - Full source code available
   - Can be customized for specific needs
   - No licensing costs

9. **Comprehensive Seed Data**
   - Sample users with different roles
   - Chart of accounts
   - Customers and suppliers
   - Items/inventory
   - Sample transactions

10. **Good Data Model Design**
    - Proper indexing on frequently queried fields
    - Foreign keys with cascade rules
    - Unique constraints where needed
    - Soft delete patterns (isActive flags)

### ⚠️ CONS (Weaknesses & Areas for Improvement)

1. **Service Layer Inconsistency**
   - Only sales.service.ts and document.service.ts exist
   - Many API routes directly use Prisma without service abstraction
   - Inconsistent business logic placement

2. **Missing API Endpoints**
   - Some modules may lack full CRUD API coverage
   - Reports APIs may be incomplete
   - Settings APIs may be limited

3. **Frontend Page Completeness**
   - Some pages may be stubs/basic
   - Form validation may be inconsistent
   - UI polish may vary across modules

4. **Testing Coverage**
   - No visible test files (unit, integration, E2E)
   - UAT guide exists but automated tests missing
   - Difficult to verify changes don't break existing functionality

5. **Performance Considerations**
   - No caching strategy implemented
   - Complex queries may not be optimized
   - No pagination mentioned in schema (may be implemented in queries)
   - Large dataset handling not tested

6. **Mobile & Responsive Design**
   - May not be fully mobile-optimized
   - Touch interactions may not be considered
   - Mobile navigation may need work

7. **Security Aspects to Review**
   - Input validation on all API endpoints (may not be comprehensive)
   - Rate limiting not implemented
   - CSRF protection (NextAuth handles but verify)
   - SQL injection (Prisma protects but raw queries need care)
   - XSS protection (React helps but verify dangerouslySetInnerHTML usage)

8. **Operational Concerns**
   - No logging framework (console.log only?)
   - No monitoring/alerting
   - Backup strategy for SQLite not documented
   - Migration strategy for production (Prisma migrate vs db push)

9. **User Experience**
   - Onboarding may be incomplete
   - Help/documentation in-app may be limited
   - Error messages may not be user-friendly
   - Loading states may be inconsistent

10. **Scalability**
    - SQLite has limitations for concurrent writes
    - No horizontal scaling consideration
    - Single-server deployment only
    - No load balancing

---

## 14. RECOMMENDATIONS FOR MODERNIZATION

### 14.1 Accounting & Finance Best Practices

#### A. Chart of Accounts Structure
**Current:** Basic hierarchical COA with 5+ types  
**Recommendation:** 
- Implement standard account numbering schemes (e.g., 1000s for Assets, 2000s for Liabilities, etc.)
- Add account groups for financial statement organization
- Consider industry-specific account templates (retail, service, manufacturing)

#### B. Double-Entry Accounting Enforcement
**Current:** Journal entries with debit/credit, isBalanced flag  
**Recommendation:**
- Enforce debit = credit at database level (trigger or application logic)
- Auto-post balancing entries when discrepancies found
- Implement trial balance report
- Add account type validation (assets normal debit, liabilities normal credit)

#### C. Period Locking
**Current:** No period locking mechanism  
**Recommendation:**
- Implement fiscal period management
- Prevent posting to closed periods
- Allow period reopening with audit trail
- Add cut-off date enforcement for transactions

#### D. Tax Compliance
**Current:** Tax codes with rates, tax reports  
**Recommendation:**
- Add tax jurisdiction support (state, province, country)
- Implement tax exempt customer handling
- Add tax rounding rules (per line vs per document)
- Support tax inclusive vs exclusive pricing
- Add tax audit trail

#### E. Multi-Currency Improvements
**Current:** Exchange rates, currency on transactions  
**Recommendation:**
- Implement realized/unrealized gain/loss tracking
- Add currency gain/loss journal entries on payment
- Support multi-currency bank accounts
- Add currency gain/loss reports

#### F. Cost Accounting
**Current:** Basic cost account on items  
**Recommendation:**
- Implement inventory valuation methods (FIFO, LIFO, Weighted Average)
- Track cost of goods sold (COGS)
- Add inventory valuation reports
- Support landed cost tracking (freight, duties on purchases)

### 14.2 Technical Modernization

#### A. Code Organization
**Current:** Mixed service and API logic  
**Recommendation:**
- Complete service layer for all modules
- Move all business logic out of API routes
- Implement repository pattern if needed
- Consistent error handling across services

#### B. Validation & Error Handling
**Current:** Zod in some forms, mixed API validation  
**Recommendation:**
- Validate all API inputs with Zod
- Consistent error response format
- Proper HTTP status codes
- User-friendly error messages with technical details in logs

#### C. Testing Strategy
**Current:** No visible tests  
**Recommendation:**
- Unit tests for services and utilities
- Integration tests for API endpoints
- E2E tests for critical user flows
- Use Vitest or Jest for testing
- Setup CI/CD with test automation

#### D. Performance Optimization
**Current:** Basic indexing  
**Recommendation:**
- Add composite indexes for common query patterns
- Implement pagination for list endpoints
- Add caching for frequently accessed data (Redis or in-memory)
- Optimize N+1 queries (Prisma include/select)
- Consider database read replicas for reporting

#### E. Security Enhancements
**Current:** Basic auth, bcrypt  
**Recommendation:**
- Add rate limiting (express-rate-limit or similar)
- Implement IP whitelist for sensitive operations
- Add audit logging for auth events (login, logout, password change)
- Implement session invalidation on password change
- Add 2FA option (TOTP)
- Security headers (Helmet or similar)
- CORS configuration review

#### F. Operational Readiness
**Current:** Basic setup  
**Recommendation:**
- Structured logging (winston, pino)
- Health check endpoints
- Metrics endpoints (Prometheus format)
- Error tracking integration (Sentry, etc.)
- Database backup automation
- Deployment pipeline (GitHub Actions)
- Environment-specific configurations

---

## 15. FUTURE DEVELOPMENT ROADMAP

### Phase 1: Stabilization & Polish (Immediate)

1. **Complete Missing APIs**
   - Fill gaps in CRUD coverage
   - Add reports APIs
   - Add settings APIs

2. **Frontend Polish**
   - Responsive design improvements
   - Consistent form validation
   - Loading and error states
   - User feedback improvements

3. **Testing**
   - Unit tests for services
   - Integration tests for APIs
   - Critical path E2E tests

4. **Documentation**
   - API documentation (OpenAPI/Swagger)
   - Code comments
   - Developer setup guide improvements

### Phase 2: Feature Enhancements (Short-term)

1. **Email Integration**
   - Send invoices/quotes via email
   - Email templates
   - Email history tracking

2. **Document Management**
   - Actual file upload/storage
   - Document versioning
   - Document preview

3. **Inventory Enhancements**
   - Stock adjustments workflow
   - Barcode scanning (mobile)
   - Multiple warehouse/location support
   - Inventory valuation reports

4. **Banking Enhancements**
   - Bank feed integration (Plaid, etc.)
   - Transaction categorization rules
   - Recurring transactions

5. **Approval Workflow**
   - Multi-level approvals
   - Approval delegation
   - Approval notifications

### Phase 3: Advanced Features (Medium-term)

1. **Multi-company Support**
   - Company entity management
   - Company-specific settings
   - Cross-company transactions (if needed)

2. **Multi-language Support**
   - i18n framework
   - Translation management
   - RTL language support

3. **Advanced Reporting**
   - Custom report builder
   - Scheduled report generation
   - Report export (PDF, Excel)
   - BI dashboard integration

4. **Cost Accounting**
   - Inventory valuation methods
   - COGS tracking
   - Profitability analysis by product/customer/project

5. **Payroll Integration**
   - Employee management
   - Payroll processing
   - Payroll journal entries

### Phase 4: Enterprise Features (Long-term)

1. **API for Integrations**
   - Public API with authentication
   - Webhook support
   - Integration documentation

2. **Mobile Application**
   - React Native or PWA
   - Mobile-optimized workflows
   - Offline capabilities

3. **Advanced Analytics**
   - Forecasting
   - Predictive analytics
   - Custom metrics dashboard

4. **Marketplace Integrations**
   - E-commerce platforms (Shopify, WooCommerce)
   - Marketplace integrations (Amazon, eBay)
   - Payment gateway integrations

5. **AI Features**
   - Smart transaction categorization
   - Cash flow prediction
   - Anomaly detection
   - Chat-based queries (using existing AI integration point)

---

## 📎 APPENDIX

### A. Seed Data Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@easynet.local | Admin123! |
| Controller | controller@easynet.local | Controller123! |
| Sales | sales@easynet.local | Sales123! |
| Purchase | purchase@easynet.local | Purchase123! |
| Stock | stock@easynet.local | Stock123! |
| Manager | manager@easynet.local | Manager123! |

### B. Environment Variables

```env
# Database
DATABASE_URL="file:./dev.db"  # SQLite
# Or for PostgreSQL:
# DATABASE_URL="postgresql://user:pass@host:5432/dbname"

# NextAuth
NEXTAUTH_SECRET="your-secret-here-min-32-chars"
NEXTAUTH_URL="http://localhost:3000"

# Frontend
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Session
AUTH_SECRET="your-auth-secret-here-min-32-chars"
```

### C. npm Scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "db:generate": "prisma generate",
    "db:push": "prisma db push",
    "db:migrate": "prisma migrate dev",
    "db:studio": "prisma studio",
    "db:seed": "tsx prisma/seed.ts",
    "hash-password": "tsx scripts/hash-password.ts",
    "lint": "next lint"
  }
}
```

---

**Document Version:** 1.0  
**Last Updated:** 2026-09-10  
**Author:** System Analysis  
**Status:** Complete

---

*This blueprint serves as the authoritative technical reference for the Easynet Mini ERP system. It should be used by AI tools for system understanding, by developers for implementation guidance, and by stakeholders for system overview.*
