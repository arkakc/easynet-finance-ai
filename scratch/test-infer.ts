import { prisma } from "../src/lib/prisma";

export function inferParentCode(code: string, allCodes: Set<string>): string | null {
  const clean = code.trim();
  if (clean.includes(".")) {
    // Dotted hierarchy: 1.1.2.1 -> 1.1.2 -> 1.1 -> 1
    const parts = clean.split(".");
    while (parts.length > 1) {
      parts.pop();
      const candidate = parts.join(".");
      if (allCodes.has(candidate)) return candidate;
    }
    return null;
  }

  if (/^\d{4}$/.test(clean)) {
    if (clean.endsWith("000")) return null; // Root (e.g. 1000, 2000, etc.)
    if (clean.endsWith("00")) {
      const p = clean[0] + "000";
      return allCodes.has(p) ? p : null;
    }
    if (clean.endsWith("0")) {
      const p1 = clean.slice(0, 2) + "00";
      if (allCodes.has(p1)) return p1;
      const p2 = clean[0] + "000";
      if (allCodes.has(p2)) return p2;
      return null;
    }
    // Ends with non-zero digit, e.g. 1111 -> 1110 -> 1100 -> 1000
    const p1 = clean.slice(0, 3) + "0";
    if (allCodes.has(p1)) return p1;
    const p2 = clean.slice(0, 2) + "00";
    if (allCodes.has(p2)) return p2;
    const p3 = clean[0] + "000";
    if (allCodes.has(p3)) return p3;
  }

  // Generalized prefix search for codes like 11100, 11000, etc.
  for (let len = clean.length - 1; len >= 1; len--) {
    const candidate = clean.slice(0, len);
    if (allCodes.has(candidate)) return candidate;
    // Padded with zeros (e.g. for 5-digit: 11120 -> 11100 -> 11000)
    const padded = candidate.padEnd(clean.length, "0");
    if (padded !== clean && allCodes.has(padded)) return padded;
  }

  return null;
}

async function main() {
  const accs = await prisma.chartOfAccounts.findMany({ select: { code: true, name: true } });
  const allCodes = new Set(accs.map(a => a.code));
  let matched = 0;
  let roots: string[] = [];

  for (const a of accs) {
    const p = inferParentCode(a.code, allCodes);
    if (p) {
      matched++;
    } else {
      roots.push(`${a.code} - ${a.name}`);
    }
  }

  console.log("Total accounts:", accs.length);
  console.log("Matched children:", matched);
  console.log("Roots count:", roots.length);
  console.log("Roots:", roots);
}

main().catch(console.error);
