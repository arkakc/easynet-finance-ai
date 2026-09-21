import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { verifyAuditIntegrity } from "@/lib/security/audit";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const viewer = await requirePermission("audit.read");
  const [integrity, entries] = await Promise.all([
    verifyAuditIntegrity(),
    prisma.auditLog.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        id: true,
        createdAt: true,
        action: true,
        outcome: true,
        entityType: true,
        entityCode: true,
        description: true,
        actorEmail: true,
        ipAddress: true,
        requestId: true,
        integrityHash: true,
      },
    }),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Audit Trail</h2>
          <p className="small">Application audit review with HMAC integrity sealing for Phase 9 events.</p>
        </div>
        <div className="page-head-actions">
          {viewer.permissions.includes("security.manage") && <Link className="button-link secondary-link" href="/security">Security Controls</Link>}
          <Link className="button-link secondary-link" href="/controls">Finance Controls</Link>
          <span className="badge">Audit Read</span>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="label">Integrity Status</div>
          <div className="value small-value">{integrity.valid ? "VALID" : "BROKEN"}</div>
        </div>
        <div className="card"><div className="label">Sealed Events</div><div className="value">{integrity.sealedEntries}</div></div>
        <div className="card"><div className="label">Legacy Unsealed</div><div className="value">{integrity.legacyUnsealedEntries}</div></div>
        <div className="card"><div className="label">Latest Seal</div><div className="value small-value">{integrity.headHash ? integrity.headHash.slice(0, 12) : "—"}</div></div>
      </div>

      {!integrity.valid && (
        <section className="panel warning-panel">
          <strong>Audit integrity verification failed.</strong> Audit integrity failure detected at event {integrity.brokenAtId || "unknown"}.
        </section>
      )}

      <section className="panel table-wrap">
        <div className="form-title-row">
          <div><h3>Recent Audit Events</h3><p className="small">Newest 200 events. Legacy records created before Phase 9 remain readable but are identified as unsealed.</p></div>
          <span className="auto-badge">{entries.length} Events</span>
        </div>
        <table className="data-table" style={{ minWidth: 1200 }}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Outcome</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Entity</th>
              <th>Description</th>
              <th>Request</th>
              <th>Integrity</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((row) => (
              <tr key={row.id}>
                <td>{row.createdAt.toLocaleString()}</td>
                <td><strong>{row.outcome}</strong></td>
                <td>{row.action}</td>
                <td>{row.actorEmail || "System"}{row.ipAddress ? <><br /><span className="small">{row.ipAddress}</span></> : null}</td>
                <td>{row.entityType}{row.entityCode ? <><br /><span className="small">{row.entityCode}</span></> : null}</td>
                <td>{row.description || "—"}</td>
                <td><span className="small">{row.requestId ? row.requestId.slice(0, 12) : "—"}</span></td>
                <td>{row.integrityHash ? <strong>SEALED</strong> : <span className="small">LEGACY</span>}</td>
              </tr>
            ))}
            {!entries.length && <tr><td colSpan={8}>No audit events recorded.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
