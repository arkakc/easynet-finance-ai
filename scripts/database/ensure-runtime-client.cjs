// Only regenerate Prisma when the installed client is absent or out of date.
// This avoids Windows DLL replacement failures while next start holds the engine open.
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const root = path.resolve(__dirname, "../..");
const generatedDir = path.join(root, "node_modules", ".prisma", "client");
const sourceSchema = path.join(root, "prisma", "schema.prisma");
const clientSchema = path.join(generatedDir, "schema.prisma");
const engine = path.join(generatedDir, "query_engine-windows.dll.node");
const clientEntry = path.join(generatedDir, "index.js");

function hasMatchingClient() {
  try {
    return fs.existsSync(engine) && fs.existsSync(clientEntry) &&
      fs.readFileSync(sourceSchema).equals(fs.readFileSync(clientSchema));
  } catch {
    return false;
  }
}
if (process.platform === "win32" && hasMatchingClient()) {
  console.log("Existing PostgreSQL Prisma client matches schema; skipping redundant DLL regeneration.");
} else {
  console.log("Prisma client missing or schema changed; generating runtime client.");
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = cp.spawnSync(command, ["run", "db:runtime-client"], {
    cwd: root, stdio: "inherit", shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
