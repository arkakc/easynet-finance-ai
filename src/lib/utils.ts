/**
 * Shared Utility Functions
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Tailwind class merging utility
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format currency
export function formatCurrency(
  amount: number | string,
  currency: string = 'USD',
  options?: { showSign?: boolean; decimals?: number }
): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return 'K0.00';

  const decimals = options?.decimals ?? 2;

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(num);
  } catch {
    return `K${num.toFixed(decimals)}`;
  }
}

// Format date
export function formatDate(
  date: Date | string,
  format: 'short' | 'long' | 'iso' | 'relative' = 'short',
  timezone: string = 'UTC'
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return 'Invalid date';

  switch (format) {
    case 'short':
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    case 'long':
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    case 'iso':
      return d.toISOString().split('T')[0];
    case 'relative':
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        if (diffHours === 0) {
          const diffMins = Math.floor(diffMs / (1000 * 60));
          if (diffMins < 1) return 'Just now';
          return `${diffMins}m ago`;
        }
        return `${diffHours}h ago`;
      }
      if (diffDays < 0) return 'In the future';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;
      if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
      if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
      return `${Math.floor(diffDays / 365)}y ago`;
    default:
      return d.toISOString();
  }
}

// Format datetime
export function formatDateTime(
  date: Date | string,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return 'Invalid date';

  return d.toLocaleString('en-US', options ?? {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Truncate text
export function truncate(text: string, length: number = 100): string {
  if (text.length <= length) return text;
  return text.slice(0, length).trim() + '...';
}

// Generate document number
export function generateDocumentNumber(
  prefix: string,
  year: number = new Date().getFullYear(),
  sequence: number
): string {
  const yearStr = year.toString();
  const seqStr = String(sequence).padStart(5, '0');
  return `${prefix}-${yearStr}-${seqStr}`;
}

// Parse document number to extract components
export function parseDocumentNumber(docNumber: string): { prefix: string; year: number; sequence: number } | null {
  const match = docNumber.match(/^(.+)-(\d{4})-(\d+)$/);
  if (!match) return null;

  return {
    prefix: match[1],
    year: parseInt(match[2], 10),
    sequence: parseInt(match[3], 10),
  };
}

// Calculate percentage
export function percentage(part: number, total: number, decimals: number = 2): number {
  if (total === 0) return 0;
  return parseFloat(((part / total) * 100).toFixed(decimals));
}

// Calculate difference
export function difference(amount: number, base: number): number {
  return amount - base;
}

// Calculate variance percent
export function variancePercent(actual: number, budget: number, decimals: number = 2): number {
  if (budget === 0) return 0;
  return parseFloat((((actual - budget) / Math.abs(budget)) * 100).toFixed(decimals));
}

// Class name helper for status badges
export function getStatusClass(status: string, type: 'success' | 'warning' | 'danger' | 'info' | 'neutral'): string {
  const classes: Record<string, Record<string, string>> = {
    success: {
      DRAFT: 'bg-slate-100 text-slate-700',
      SENT: 'bg-blue-100 text-blue-700',
      ACCEPTED: 'bg-green-100 text-green-700',
      POSTED: 'bg-green-100 text-green-700',
      APPROVED: 'bg-green-100 text-green-700',
      PAID: 'bg-green-100 text-green-700',
      CLEARED: 'bg-green-100 text-green-700',
      COMPLETED: 'bg-green-100 text-green-700',
      ACTIVE: 'bg-green-100 text-green-700',
      RECEIVED: 'bg-green-100 text-green-700',
      REJECTED: 'bg-red-100 text-red-700',
      VOID: 'bg-slate-100 text-slate-500',
      CLOSED: 'bg-slate-100 text-slate-500',
    },
    warning: {
      PARTIAL: 'bg-yellow-100 text-yellow-700',
      PARTIAL_RECEIVED: 'bg-yellow-100 text-yellow-700',
      OVERDUE: 'bg-orange-100 text-orange-700',
      PENDING: 'bg-yellow-100 text-yellow-700',
      SUBMITTED: 'bg-yellow-100 text-yellow-700',
      IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
      REVERSED: 'bg-orange-100 text-orange-700',
      FAILED: 'bg-red-100 text-red-700',
    },
    danger: {
      CANCELLED: 'bg-red-100 text-red-700',
      REJECTED: 'bg-red-100 text-red-700',
      SUSPENDED: 'bg-red-100 text-red-700',
      DEACTIVED: 'bg-red-100 text-red-700',
      EXPIRED: 'bg-red-100 text-red-700',
    },
    info: {
      PLANNING: 'bg-indigo-100 text-indigo-700',
      ON_HOLD: 'bg-slate-100 text-slate-600',
      COMPLETED: 'bg-slate-100 text-slate-600',
    },
    neutral: {
      DRAFT: 'bg-slate-100 text-slate-600',
      CREATED: 'bg-slate-100 text-slate-600',
    },
  };

  return classes[type]?.[status] || 'bg-slate-100 text-slate-600';
}

// Database query helper - format results
export function formatApiResponse<T>(
  data: T,
  message?: string,
  success: boolean = true,
  error?: string
) {
  return {
    success,
    message,
    data,
    error,
    timestamp: new Date().toISOString(),
  };
}

// Pagination helper
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number
): PaginatedResult<T> {
  const totalPages = Math.ceil(total / pageSize);
  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

// Sort helper
export function sortBy<T>(array: T[], key: keyof T, direction: 'asc' | 'desc' = 'asc'): T[] {
  return [...array].sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];

    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;

    let comparison = 0;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      comparison = aVal.localeCompare(bVal);
    } else if (typeof aVal === 'number' && typeof bVal === 'number') {
      comparison = aVal - bVal;
    } else {
      comparison = String(aVal).localeCompare(String(bVal));
    }

    return direction === 'asc' ? comparison : -comparison;
  });
}

// Filter helper for numeric ranges
export function filterByRange<T>(
  array: T[],
  key: keyof T,
  min?: number,
  max?: number
): T[] {
  return array.filter((item) => {
    const val = item[key];
    if (typeof val !== 'number') return true;
    if (min !== undefined && val < min) return false;
    if (max !== undefined && val > max) return false;
    return true;
  });
}

// Date range helper
export function getDateRange(
  start: Date | string,
  end: Date | string
): { start: Date; end: Date } {
  const startDate = typeof start === 'string' ? new Date(start) : start;
  const endDate = typeof end === 'string' ? new Date(end) : end;

  // Set end date to end of day
  endDate.setHours(23, 59, 59, 999);

  return { start: startDate, end: endDate };
}

// Debounce helper
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function (...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Throttle helper
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return function (...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// Local storage helpers
export function getLocalStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;

  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch {
    return fallback;
  }
}

export function setLocalStorage<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable
  }
}

// Generate ID helper
export function generateId(prefix: string = 'id'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

// Bold/Italic/Underline text helper for rich text fields
export function sanitizeHtml(text: string): string {
  return text
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '')
    .trim();
}
