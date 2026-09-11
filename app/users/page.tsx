import { listConfiguredUsers, requirePermission, ROLE_PERMISSIONS } from "@/lib/auth";

export default async function UsersPage() {
  await requirePermission("users.manage");
  const users = listConfiguredUsers();
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
          <details className="system-notice-tab">
            <summary>
              <span>ℹ️ System Notice</span>
              <span className="notice-arrow">▾</span>
            </summary>
            <div className="system-notice-dropdown">
              <strong>Credential management:</strong> Users are provisioned through server environment configuration using scrypt password hashes. This prevents plain-text credentials from entering client code or logs.
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
          <div className="label">Security Hash</div>
          <div className="value small-value">scrypt / AES-GCM</div>
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
                    {user.disabled ? "Disabled" : "Active"}
                  </span>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={4}>No ERP users configured. Add ERP_USERS_JSON in the server environment before production use.</td>
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
