"use client";

import { useState } from "react";

type SecurityUser = {
  userId: string;
  email: string;
  name: string;
  roles: string[];
  disabled: boolean;
  status: string;
  lastLoginAt: string | null;
  lastFailedLoginAt: string | null;
  failedLoginCount: number;
  lockedUntil: string | null;
  sessionVersion: number;
};

const ROLES = [
  "SYSTEM_MANAGER",
  "FINANCE_CONTROLLER",
  "ACCOUNTS_USER",
  "SALES_USER",
  "PURCHASE_USER",
  "STOCK_USER",
  "MANAGEMENT",
  "AUDITOR",
] as const;

const DISPLAY_TO_ENUM: Record<string, string> = {
  "System Manager": "SYSTEM_MANAGER",
  "Finance Controller": "FINANCE_CONTROLLER",
  "Accounts User": "ACCOUNTS_USER",
  "Sales User": "SALES_USER",
  "Purchase User": "PURCHASE_USER",
  "Stock User": "STOCK_USER",
  "Management": "MANAGEMENT",
  "Auditor": "AUDITOR",
};

const label = (value: string) =>
  value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

export default function SecurityClient({ initialUsers }: { initialUsers: SecurityUser[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function reload() {
    const response = await fetch("/api/security/users", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Security users could not be loaded");
    setUsers(payload.users);
  }

  async function action(userId: string, body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(userId);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/security/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...body }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Security action failed");
      await reload();
      setMessage("Security control updated and audit event sealed.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Security action failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      {message && <section className="panel"><strong>{message}</strong></section>}
      {error && <section className="panel warning-panel"><strong>Security action failed.</strong> {error}</section>}

      <section className="panel table-wrap">
        <div className="form-title-row">
          <div>
            <h3>User Security Controls</h3>
            <p className="small">Role/status changes revoke all existing sessions automatically. Explicit session revoke increments the server-side session version.</p>
          </div>
          <span className="auto-badge">{users.length} Users</span>
        </div>
        <table className="data-table" style={{ minWidth: 1180 }}>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th>Login Security</th>
              <th>Last Login</th>
              <th>Session Version</th>
              <th>Controls</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const locked = Boolean(user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now());
              const roleValue = DISPLAY_TO_ENUM[user.roles[0] || ""] || "AUDITOR";
              return (
                <tr key={user.userId}>
                  <td><strong>{user.name}</strong><br /><span className="small">{user.email}</span></td>
                  <td>
                    <select
                      value={roleValue}
                      disabled={busy === user.userId}
                      onChange={(event) => void action(
                        user.userId,
                        { action: "set_role", role: event.target.value },
                        `Change ${user.email} role to ${label(event.target.value)}? Existing sessions will be revoked.`,
                      )}
                    >
                      {ROLES.map((role) => <option value={role} key={role}>{label(role)}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      value={user.status}
                      disabled={busy === user.userId}
                      onChange={(event) => void action(
                        user.userId,
                        { action: "set_status", status: event.target.value },
                        `Change ${user.email} status to ${label(event.target.value)}? Existing sessions will be revoked.`,
                      )}
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="SUSPENDED">Suspended</option>
                      <option value="DEACTIVED">Deactivated</option>
                    </select>
                  </td>
                  <td>
                    <strong>{locked ? "LOCKED" : "OK"}</strong>
                    <br />
                    <span className="small">Failed: {user.failedLoginCount}{user.lockedUntil ? ` · until ${new Date(user.lockedUntil).toLocaleString()}` : ""}</span>
                  </td>
                  <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</td>
                  <td>{user.sessionVersion}</td>
                  <td>
                    <div className="button-row">
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy === user.userId}
                        onClick={() => void action(
                          user.userId,
                          { action: "revoke_sessions" },
                          `Revoke every active session for ${user.email}?`,
                        )}
                      >
                        Revoke Sessions
                      </button>
                      {(locked || user.failedLoginCount > 0) && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy === user.userId}
                          onClick={() => void action(user.userId, { action: "unlock" })}
                        >
                          Unlock
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!users.length && <tr><td colSpan={7}>No security-managed users configured.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
