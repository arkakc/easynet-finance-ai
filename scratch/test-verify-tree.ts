import { createSessionToken } from "../lib/auth";

async function verify() {
  const token = createSessionToken({
    email: "admin@easynet.local",
    name: "Test System Administrator",
    roles: ["System Manager"],
    permissions: [
      "dashboard.read",
      "sales.read",
      "sales.write",
      "purchase.read",
      "purchase.write",
      "stock.read",
      "stock.write",
      "accounts.read",
      "accounts.write",
      "reports.read",
      "users.manage",
      "settings.manage",
      "post.approve",
    ],
  });

  const res = await fetch("http://localhost:3000/api/ui/accounts", {
    headers: {
      Cookie: `easynet_session=${token}`,
    },
  });

  const data = await res.json();
  console.log("Status:", res.status);
  console.log("Total accounts:", data.accounts?.length);

  const roots = data.accounts.filter((a: any) => !a.parentId);
  const children = data.accounts.filter((a: any) => !!a.parentId);
  console.log(`Root accounts: ${roots.length}`);
  console.log(`Child accounts: ${children.length}`);

  console.log("\nSample root accounts:");
  roots.slice(0, 6).forEach((r: any) => console.log(`  ${r.accountCode} - ${r.accountName} (Children: ${r.childCount || 0}, Balance: ${r.balance})`));

  console.log("\nSample children under 1000 Assets:");
  const underAssets = children.filter((c: any) => c.parentCode === "1000" || c.parentCode?.startsWith("1"));
  underAssets.slice(0, 8).forEach((c: any) => console.log(`  ${c.accountCode} - ${c.accountName} -> Parent: ${c.parentCode} (${c.parentName})`));
}

verify().catch(console.error);
