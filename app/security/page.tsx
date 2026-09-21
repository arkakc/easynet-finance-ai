import Link from "next/link";
import { listConfiguredUsers, requirePermission } from "@/lib/auth";
import SecurityClient from "./security-client";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  await requirePermission("security.manage");
  const users = await listConfiguredUsers();
  const locked = users.filter((user) => user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()).length;
  const suspended = users.filter((user) => user.status !== "ACTIVE").length;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Security Control Centre</h2>
          <p className="small">Server-enforced session revocation, account lockout, role/status control and privileged security audit.</p>
        </div>
        <div className="page-head-actions">
          <Link className="button-link secondary-link" href="/users">Users & Permissions</Link>
          <Link className="button-link secondary-link" href="/audit">Audit Trail</Link>
          <span className="badge">System Manager Only</span>
        </div>
      </div>

      <div className="grid">
        <div className="card"><div className="label">Managed Users</div><div className="value">{users.length}</div></div>
        <div className="card"><div className="label">Locked Accounts</div><div className="value">{locked}</div></div>
        <div className="card"><div className="label">Non-Active Accounts</div><div className="value">{suspended}</div></div>
        <div className="card"><div className="label">Session Enforcement</div><div className="value small-value">DB VALIDATED</div></div>
      </div>

      <SecurityClient initialUsers={users} />
    </>
  );
}
