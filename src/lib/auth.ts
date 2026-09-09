/**
 * Authentication Helpers
 * Password hashing, session utilities, permission checks
 */

import bcrypt from 'bcryptjs';
import { Role, UserStatus } from '@prisma/client';

// Password hashing
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

// Permission definitions
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
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// Role → Permission mapping
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.SYSTEM_MANAGER]: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.SALES_READ,
    PERMISSIONS.SALES_WRITE,
    PERMISSIONS.SALES_APPROVE,
    PERMISSIONS.PURCHASE_READ,
    PERMISSIONS.PURCHASE_WRITE,
    PERMISSIONS.PURCHASE_APPROVE,
    PERMISSIONS.STOCK_READ,
    PERMISSIONS.STOCK_WRITE,
    PERMISSIONS.STOCK_ADJUST,
    PERMISSIONS.ACCOUNTS_READ,
    PERMISSIONS.ACCOUNTS_WRITE,
    PERMISSIONS.ACCOUNTS_POST,
    PERMISSIONS.ACCOUNTS_APPROVE,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.REPORTS_EXPORT,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_WRITE,
    PERMISSIONS.DOCUMENTS_APPROVE,
    PERMISSIONS.AI_USE,
  ],
  [Role.FINANCE_CONTROLLER]: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.SALES_READ,
    PERMISSIONS.SALES_WRITE,
    PERMISSIONS.PURCHASE_READ,
    PERMISSIONS.PURCHASE_WRITE,
    PERMISSIONS.STOCK_READ,
    PERMISSIONS.STOCK_WRITE,
    PERMISSIONS.ACCOUNTS_READ,
    PERMISSIONS.ACCOUNTS_WRITE,
    PERMISSIONS.ACCOUNTS_POST,
    PERMISSIONS.ACCOUNTS_APPROVE,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.REPORTS_EXPORT,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_WRITE,
    PERMISSIONS.DOCUMENTS_APPROVE,
    PERMISSIONS.AI_USE,
  ],
  [Role.ACCOUNTS_USER]: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.SALES_READ,
    PERMISSIONS.SALES_WRITE,
    PERMISSIONS.PURCHASE_READ,
    PERMISSIONS.STOCK_READ,
    PERMISSIONS.ACCOUNTS_READ,
    PERMISSIONS.ACCOUNTS_WRITE,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_WRITE,
    PERMISSIONS.AI_USE,
  ],
  [Role.SALES_USER]: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.SALES_READ,
    PERMISSIONS.SALES_WRITE,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_WRITE,
    PERMISSIONS.AI_USE,
  ],
  [Role.PURCHASE_USER]: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.PURCHASE_READ,
    PERMISSIONS.PURCHASE_WRITE,
    PERMISSIONS.STOCK_READ,
    PERMISSIONS.STOCK_WRITE,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_WRITE,
    PERMISSIONS.AI_USE,
  ],
  [Role.STOCK_USER]: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.PURCHASE_READ,
    PERMISSIONS.STOCK_READ,
    PERMISSIONS.STOCK_WRITE,
    PERMISSIONS.STOCK_ADJUST,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_WRITE,
    PERMISSIONS.AI_USE,
  ],
  [Role.MANAGEMENT]: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.SALES_READ,
    PERMISSIONS.PURCHASE_READ,
    PERMISSIONS.STOCK_READ,
    PERMISSIONS.ACCOUNTS_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.DOCUMENTS_READ,
  ],
  [Role.AUDITOR]: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.SALES_READ,
    PERMISSIONS.PURCHASE_READ,
    PERMISSIONS.STOCK_READ,
    PERMISSIONS.ACCOUNTS_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.DOCUMENTS_READ,
  ],
  [Role.USER]: [
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.REPORTS_READ,
  ],
};

// Check if user has a specific permission
export function hasPermission(userRole: Role, permission: Permission): boolean {
  const rolePermissions = ROLE_PERMISSIONS[userRole] || [];
  return rolePermissions.includes(permission);
}

// Check if user has any of the required permissions
export function hasAnyPermission(userRole: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(userRole, p));
}

// Check if user has all of the required permissions
export function hasAllPermissions(userRole: Role, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(userRole, p));
}

// Get display name for a permission
export function getPermissionLabel(permission: Permission): string {
  const labels: Record<Permission, string> = {
    [PERMISSIONS.DASHBOARD_READ]: 'View Dashboard',
    [PERMISSIONS.SALES_READ]: 'View Sales Documents',
    [PERMISSIONS.SALES_WRITE]: 'Create/Edit Sales Documents',
    [PERMISSIONS.SALES_APPROVE]: 'Approve Sales Documents',
    [PERMISSIONS.PURCHASE_READ]: 'View Purchase Documents',
    [PERMISSIONS.PURCHASE_WRITE]: 'Create/Edit Purchase Documents',
    [PERMISSIONS.PURCHASE_APPROVE]: 'Approve Purchase Documents',
    [PERMISSIONS.STOCK_READ]: 'View Inventory',
    [PERMISSIONS.STOCK_WRITE]: 'Create/Edit Inventory',
    [PERMISSIONS.STOCK_ADJUST]: 'Adjust Stock Levels',
    [PERMISSIONS.ACCOUNTS_READ]: 'View Accounting Data',
    [PERMISSIONS.ACCOUNTS_WRITE]: 'Create/Edit Accounting Entries',
    [PERMISSIONS.ACCOUNTS_POST]: 'Post Journal Entries',
    [PERMISSIONS.ACCOUNTS_APPROVE]: 'Approve Journal Entries',
    [PERMISSIONS.REPORTS_READ]: 'View Reports',
    [PERMISSIONS.REPORTS_EXPORT]: 'Export Reports',
    [PERMISSIONS.USERS_MANAGE]: 'Manage Users',
    [PERMISSIONS.SETTINGS_MANAGE]: 'Manage Settings',
    [PERMISSIONS.AUDIT_VIEW]: 'View Audit Logs',
    [PERMISSIONS.DOCUMENTS_READ]: 'View Documents',
    [PERMISSIONS.DOCUMENTS_WRITE]: 'Upload/Edit Documents',
    [PERMISSIONS.DOCUMENTS_APPROVE]: 'Approve Documents',
    [PERMISSIONS.AI_USE]: 'Use AI Features',
  };
  return labels[permission] || permission;
}

// Get role display name
export function getRoleLabel(role: Role): string {
  const labels: Record<Role, string> = {
    [Role.SYSTEM_MANAGER]: 'System Manager',
    [Role.FINANCE_CONTROLLER]: 'Finance Controller',
    [Role.ACCOUNTS_USER]: 'Accounts User',
    [Role.SALES_USER]: 'Sales User',
    [Role.PURCHASE_USER]: 'Purchase User',
    [Role.STOCK_USER]: 'Stock User',
    [Role.MANAGEMENT]: 'Management',
    [Role.AUDITOR]: 'Auditor',
    [Role.USER]: 'Standard User',
  };
  return labels[role] || role;
}

// User status display
export function getUserStatusLabel(status: UserStatus): string {
  const labels: Record<UserStatus, string> = {
    [UserStatus.ACTIVE]: 'Active',
    [UserStatus.SUSPENDED]: 'Suspended',
    [UserStatus.INVITED]: 'Invited',
    [UserStatus.DEACTIVED]: 'Deactivated',
  };
  return labels[status] || status;
}

// Generate strong session secret (for setup)
export function generateSecret(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let secret = '';
  for (let i = 0; i < length; i++) {
    secret += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return secret;
}
