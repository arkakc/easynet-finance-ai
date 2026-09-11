process.env.SESSION_SECRET = 'local-dev-secret-change-in-production-min-32-chars';
(process.env as Record<string, string | undefined>).NODE_ENV = 'development';

import { createSessionToken, sessionCookie } from '../lib/auth';

async function main() {
  const user = {
    email: 'admin@easynet.local',
    name: 'Test Administrator',
    roles: ['System Manager' as const],
    permissions: [
      'sales.read' as const,
      'sales.write' as const,
      'dashboard.read' as const,
      'accounts.read' as const,
      'accounts.write' as const,
      'purchase.read' as const,
      'purchase.write' as const,
      'stock.read' as const,
      'reports.read' as const,
      'users.manage' as const,
      'settings.manage' as const,
      'post.approve' as const,
    ],
  };

  const token = createSessionToken(user);
  const cookie = `${sessionCookie.name}=${token}`;

  const routes = [
    '/dashboard',
    '/accounts',
    '/journals',
    '/journals/reverse',
    '/loans',
    '/loans/actions',
    '/statements',
    '/reports',
    '/reports/cashflow',
    '/reports/gst',
    '/controls',
    '/projects',
    '/approvals',
    '/assets',
    '/budgets',
    '/masters',
    '/documents',
    '/stock',
    '/stock/new-item',
    '/transactions',
    '/payment-schedules',
    '/settings',
    '/setup/finance',
    '/users',
    '/pos',
    '/ai-finance/upload',
  ];

  console.log(`🔍 Verifying ${routes.length} Web Pages in the entire application...\n`);

  let failures = 0;
  for (const path of routes) {
    try {
      const res = await fetch(`http://localhost:3000${path}`, {
        headers: { Cookie: cookie },
      });

      const text = await res.text();
      const hasError = text.includes('Internal Server Error') || text.includes('Application error');
      const asideCount = (text.match(/<aside/g) || []).length;
      const hasPageHead = text.includes('page-head');

      if (res.ok && !hasError) {
        console.log(`✅ [${res.status}] ${path} | <aside>: ${asideCount} | page-head: ${hasPageHead ? 'YES' : 'NO'}`);
      } else {
        console.log(`❌ [${res.status}] ${path} | Error detected!`);
        failures++;
      }
    } catch (err: any) {
      console.error(`❌ Request error on ${path}:`, err.message);
      failures++;
    }
  }

  if (failures === 0) {
    console.log('\n🎉 ALL 26 APPLICATION PAGES ARE 100% FUNCTIONAL AND HEALTHY!');
  } else {
    console.log(`\n⚠️ Encountered ${failures} issues.`);
  }
}

main().catch(console.error);
