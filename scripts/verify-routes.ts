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
    '/pos',
    '/reports/gst',
    '/api/reports/irc-gst',
    '/api/payroll/runs',
    '/api/purchases/landed-cost',
    '/api/sales/invoices',
  ];

  console.log('🔍 Testing Mini ERP HTTP Routes with Active Session Token...\n');

  for (const path of routes) {
    try {
      const res = await fetch(`http://localhost:3000${path}`, {
        headers: {
          Cookie: cookie,
        },
      });

      const text = await res.text();
      const hasError = text.includes('Internal Server Error') || text.includes('Application error');
      const asideCount = (text.match(/<aside/g) || []).length;

      if (res.ok && !hasError) {
        console.log(`✅ [${res.status}] ${path} (Payload: ${text.length} bytes, <aside> tags: ${asideCount})`);
      } else {
        console.log(`⚠️ [${res.status}] ${path} (Has error: ${hasError})`);
      }
    } catch (err: any) {
      console.error(`❌ Failed to request ${path}:`, err.message);
    }
  }

  console.log('\n🏁 HTTP Routes verification completed!');
}

main().catch(console.error);
