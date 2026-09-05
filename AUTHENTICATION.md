# Authentication & Authorization Architecture — v0.3.0

## Why this changed

v0.2.1 did not have user authentication. Sensitive write screens asked the browser user to enter `APP_SECRET`, and the API compared that shared secret before allowing writes. That was acceptable only as a private MVP control; it was not a multi-user ERP authentication model.

v0.3.0 introduces a first production-oriented authentication layer inspired by ERP role/permission separation while keeping the existing Google Apps Script data bridge.

## Components

### 1. Login UI — `app/login/page.tsx`
Collects email and password and POSTs them to `/api/auth/login`. The password is never stored in browser state beyond the form/request and is never written to Google Sheets.

### 2. Login API — `app/api/auth/login/route.ts`
Validates input, loads the configured user, verifies the password using scrypt, creates a signed session payload, and sends it as an HttpOnly cookie.

Cookie controls:
- HttpOnly — client JavaScript cannot read the session token.
- SameSite=Lax — reduces cross-site request risk.
- Secure in production — browser sends it only over HTTPS.
- 12-hour expiry.

### 3. Auth core — `lib/auth.ts`
Provides:
- user configuration parsing;
- scrypt password verification;
- role → permission expansion;
- HMAC-SHA256 signed session creation/verification;
- current-user lookup;
- server-side permission enforcement.

Roles currently defined:
- System Manager
- Finance Controller
- Accounts User
- Sales User
- Purchase User
- Stock User
- Management
- Auditor

Permissions are granular (`sales.write`, `purchase.read`, `accounts.write`, `post.approve`, `users.manage`, etc.) rather than relying on menu visibility alone.

### 4. Route protection — `proxy.ts`
Before protected pages/APIs run, the signed session cookie is verified. Unauthenticated browser requests are redirected to `/login`; unauthenticated APIs return 401. Routes with an explicit permission requirement return/redirect on 403 when the user lacks that permission.

### 5. ERP server gateways
`app/api/erp/transactions/route.ts` and `app/api/erp/conversions/route.ts` enforce user permissions before forwarding work to the existing accounting APIs.

The browser no longer sends `APP_SECRET` for these workflows. The gateway adds the legacy application secret only on the server, preserving compatibility while the old API surface is progressively retired.

### 6. Users & Permissions UI — `app/users/page.tsx`
System Managers can view configured users, assigned roles, enabled/disabled status and the role-permission matrix. Password hashes and session secrets are deliberately excluded from the response/UI.

## Request flow

```text
Browser
  │
  │ POST /api/auth/login {email,password}
  ▼
Next.js Login API
  │  verify scrypt password hash
  │  issue signed HttpOnly easynet_session cookie
  ▼
Browser session
  │
  │ request page/API + cookie automatically
  ▼
Next.js proxy
  │  verify signature + expiry
  │  enforce route permission
  ▼
Page / ERP API gateway
  │  enforce action permission again for sensitive writes
  │  add server-only APP_SECRET for legacy internal API compatibility
  ▼
Next.js accounting/service API
  │
  │ APPS_SCRIPT_API_TOKEN (server environment only)
  ▼
Google Apps Script Web App
  │  requireToken_()
  ├─ Google Sheets finance database
  └─ Google Drive source evidence
```

## Credentials and tokens

### User passwords
Passwords are never committed to GitHub and should not be stored as plain text. Generate a scrypt hash with:

```bash
npm run hash-password -- 'A-strong-password'
```

Only the resulting `scrypt$<salt>$<hash>` value goes into `ERP_USERS_JSON` in the deployment environment.

### `SESSION_SECRET`
A high-entropy server-only secret (minimum 32 characters) used to HMAC-sign session payloads. It must be configured in Vercel/hosting environment variables and never exposed with a `NEXT_PUBLIC_` prefix.

### `APP_SECRET`
Legacy internal application write secret. In v0.3.0 the new ERP gateways keep this on the server; users no longer type it into Transactions or Document Conversions. It remains temporarily required because older APIs still use the v0.2.1 shared-secret contract.

### `APPS_SCRIPT_API_TOKEN`
Machine-to-machine credential between Next.js and Google Apps Script. `lib/backend/apps-script.ts` inserts it into backend requests. Apps Script checks it with `requireToken_()` against Script Properties. It never belongs in browser code.

The Apps Script project can rotate this token with `rotateApiToken()`. After rotation, update `APPS_SCRIPT_API_TOKEN` in the hosting environment.

### OpenAI API key
`OPENAI_API_KEY` remains server-only and is used only by AI document extraction. It is not part of user authentication.

## Environment example

```text
SESSION_SECRET=<high-entropy-secret-at-least-32-characters>
ERP_USERS_JSON=[{"email":"admin@example.com","name":"System Administrator","passwordHash":"scrypt$...$...","roles":["System Manager"]}]
APP_SECRET=<legacy-internal-write-secret>
APPS_SCRIPT_WEB_APP_URL=<apps-script-exec-url>
APPS_SCRIPT_API_TOKEN=<machine-token>
OPENAI_API_KEY=<server-only-key>
OPENAI_MODEL=gpt-5-mini
```

## Security boundary

Menu hiding is convenience, not security. Permission checks exist at the proxy and again at sensitive ERP gateways. The Google Apps Script token remains a separate machine credential, so a valid user session does not reveal or replace the backend token.

## Next hardening step

The current user directory is environment-backed to avoid putting password material in Sheets. When the persistence layer moves to PostgreSQL/Supabase or another transactional database, migrate Users, Roles, User Permissions, password reset, login-attempt throttling, session revocation and optional MFA into database-backed tables/services. Do not store password hashes in the existing generic Google Sheets business tables.
