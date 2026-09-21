import Link from "next/link";
import { listConfiguredUsers, requirePermission, ROLE_PERMISSIONS } from "@/lib/auth";

export default async function UsersPage() {
  await requirePermission("users.manage");
  const users = await listConfiguredUsers();
  const enabledUsers = users.filter((u) => !u.disabled).length;
  const roleCount = Object.keys(ROLE_PERMISSIONS).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Users & Access Permissions</h2>
          <p className="small">
            Role-based access control (RBAC). Password hashes and session secrets are cryptographically secured on the server.
          </p>
        </div>
        <div className="page-head-actions">
          <Link className="button-link secondary-link" href="/security">Security Controls</Link>
          <Link className="button-link secondary-link" href="/audit">Audit Trail</Link>
          <details className="system-notice-tab">
            <summary>
              <span>ℹ️ System Notice</span>
              <span className="notice-arrow">▾</span>
            </summary>
            <div className="system-notice-dropdown">
              <strong>Credential management:</strong> Users and password hashes are stored in the local database. Credentials are never returned to the browser.
            </div>
          </details>
          <span className="badge">RBAC Security</span>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="label">Configured Users</div>
          <div className="value">{users.length}</div>
        </div>
        <div className="card">
          <div className="label">Active Users</div>
          <div className="value">{enabledUsers}</div>
        </div>
        <div className="card">
          <div className="label">System Roles</div>
          <div className="value">{roleCount}</div>
        </div>
        <div className="card">
          <div className="label">Credential Security</div>
          <div className="value small-value">bcrypt(12) / HMAC-SHA256</div>
        </div>
      </div>

      <section className="panel table-wrap">
        <div className="form-title-row">
          <h3>User Directory</h3>
          <span className="auto-badge">{users.length} Users</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Assigned Roles</th>
              <th>Status</th>
              <th>Login Security</th>
              <th>Last Login</th>
              <th>Session Ver.</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.email}>
                <td>
                  <strong>{user.name}</strong>
                </td>
                <td>{user.email}</td>
                <td>{user.roles.join(", ")}</td>
                <td>
                  <span className={`auto-badge ${user.disabled ? "warning-text" : ""}`}>
                    {user.disabled ? user.status : "Active"}
                  </span>
                </td>
                <td>
                  {user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()
                    ? <span className="warning-text">LOCKED</span>
                    : <strong>OK</strong>}
                  <br /><span className="small">Failed: {user.failedLoginCount}</span>
                </td>
                <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</td>
                <td>{user.sessionVersion}</td>
              </tr>
            ))}
            {!users.length && (
              <tr>
              <td colSpan={7}>No ERP users have been provisioned.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel table-wrap">
        <div className="form-title-row">
          <h3>Role Permission Matrix</h3>
          <span className="auto-badge">Server-Enforced</span>
        </div>
        <p className="small">Permissions are verified on the API gateway before executing financial mutations.</p>
        <table className="data-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Granted Permissions</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => (
              <tr key={role}>
                <td>
                  <strong>{role}</strong>
                </td>
                <td>{permissions.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
