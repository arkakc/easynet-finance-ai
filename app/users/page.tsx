import { listConfiguredUsers, requirePermission, ROLE_PERMISSIONS } from "@/lib/auth";

export default async function UsersPage() {
  await requirePermission("users.manage");
  const users = listConfiguredUsers();

  return <>
    <div className="page-head"><div><h2>Users & Permissions</h2><p className="small">Role-based access control. Password hashes and session secrets are never displayed in the browser.</p></div><span className="badge">{users.length} configured users</span></div>

    <section className="panel table-wrap">
      <h3>Users</h3>
      <table className="data-table"><thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th></tr></thead><tbody>
        {users.map((user) => <tr key={user.email}><td>{user.name}</td><td>{user.email}</td><td>{user.roles.join(", ")}</td><td>{user.disabled ? "Disabled" : "Enabled"}</td></tr>)}
        {!users.length && <tr><td colSpan={4}>No ERP users configured. Add ERP_USERS_JSON in the server environment before production use.</td></tr>}
      </tbody></table>
    </section>

    <section className="panel table-wrap">
      <h3>Role Permission Matrix</h3>
      <p className="small">Permissions are enforced server-side for session transaction gateways, not only hidden in the menu.</p>
      <table className="data-table"><thead><tr><th>Role</th><th>Permissions</th></tr></thead><tbody>
        {Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => <tr key={role}><td><strong>{role}</strong></td><td>{permissions.join(" · ")}</td></tr>)}
      </tbody></table>
    </section>

    <section className="panel warning-panel"><strong>Credential management</strong><p className="small">For v0.3.0 users are provisioned through server environment configuration using scrypt password hashes. This avoids putting credentials in Google Sheets or client code. A database-backed User/Role/User Permission manager is the next persistence step when the data layer moves off Google Sheets.</p></section>
  </>;
}
