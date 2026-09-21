import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { env } from "@/lib/env";
import { requirePermission } from "@/lib/auth";
import { listTable } from "@/lib/backend/apps-script";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.object({
  itemName: z.string().trim().min(2),
  itemType: z.enum(["STOCK", "SERVICE", "NON_STOCK"]).default("STOCK"),
});

const aiSchema = z.object({
  revenueAccountId: z.string().trim().min(1),
  costAccountId: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(1).max(280),
});

type Suggestion = z.infer<typeof aiSchema> & { source: "AI" | "RULE_FALLBACK" };
type Account = {
  accountId: string;
  accountCode?: string;
  accountName?: string;
  accountType?: string;
  parentAccount?: string;
  active?: boolean | string | number;
};

function active(row: Account) {
  return !["false", "0", "no", "inactive"].includes(String(row.active ?? "true").trim().toLowerCase());
}

function heuristic(itemName: string, itemType: "STOCK" | "SERVICE" | "NON_STOCK"): Suggestion {
  const text = itemName.toLowerCase();
  let revenueAccountId = itemType === "SERVICE" ? "ACC-4100" : "ACC-4200";
  let costAccountId = itemType === "SERVICE" ? "ACC-5200" : "ACC-5100";
  let reason = "Default item-type mapping";

  const has = (...tokens: string[]) => tokens.some((token) => text.includes(token));

  if (has("cloud", "hosting", "server hosting", "vps", "domain", "subscription", "saas")) {
    revenueAccountId = "ACC-4700";
    costAccountId = "ACC-5600";
    reason = "Cloud / hosting / subscription item wording";
  } else if (has("software", "license", "licence", "microsoft 365", "office 365", "antivirus")) {
    revenueAccountId = "ACC-4300";
    costAccountId = "ACC-5400";
    reason = "Software / licence item wording";
  } else if (has("erp", "automation", "workflow", "business automation")) {
    revenueAccountId = "ACC-4500";
    costAccountId = "ACC-5200";
    reason = "ERP / business automation item wording";
  } else if (has("managed it", "managed service", "support plan", "maintenance plan")) {
    revenueAccountId = "ACC-4400";
    costAccountId = "ACC-5200";
    reason = "Managed IT service item wording";
  } else if (has("consult", "technical support", "professional service", "implementation", "training")) {
    revenueAccountId = "ACC-4600";
    costAccountId = has("subcontract", "consultant") ? "ACC-5300" : "ACC-5200";
    reason = "Consulting / technical service item wording";
  } else if (has("freight", "delivery", "shipping", "transport")) {
    revenueAccountId = itemType === "SERVICE" ? "ACC-4600" : "ACC-4900";
    costAccountId = "ACC-5500";
    reason = "Freight / delivery item wording";
  } else if (has("network", "cctv", "camera", "firewall", "router", "switch", "wifi", "wi-fi", "starlink", "nas", "server", "installation", "ict")) {
    // Physical ICT equipment is hardware for revenue classification. Only
    // service/non-stock ICT work belongs in the general services revenue
    // account. This prevents items such as network switches and routers from
    // being classified as software revenue when the AI fallback is used.
    revenueAccountId = itemType === "STOCK" ? "ACC-4200" : "ACC-4100";
    costAccountId = itemType === "STOCK" ? "ACC-5100" : "ACC-5200";
    reason = itemType === "STOCK" ? "ICT hardware item wording" : "ICT service item wording";
  } else if (itemType === "STOCK") {
    revenueAccountId = "ACC-4200";
    costAccountId = "ACC-5100";
    reason = "Stock / hardware item default";
  } else if (itemType === "SERVICE") {
    revenueAccountId = "ACC-4100";
    costAccountId = "ACC-5200";
    reason = "Service item default";
  }

  return { revenueAccountId, costAccountId, confidence: 0.55, reason, source: "RULE_FALLBACK" };
}

function accountLabel(account: Account | undefined, id: string) {
  if (!account) return id;
  const name = String(account.accountName || id);
  const code = String(account.accountCode || "");
  return `${name} (${id})${code ? ` · ${code}` : ""}`;
}

export async function POST(request: Request) {
  try {
    // Read-only classifier used by both Sales and Purchase item-materialization flows.
    // Actual Item Master writes remain protected by their respective sales.write / purchase.write routes.
    await requirePermission("dashboard.read");
    const input = requestSchema.parse(await request.json());
    const result = await listTable<Account>("Accounts", 500, 0);
    const rows = result.rows || [];
    const parentIds = new Set(rows.map((row) => String(row.parentAccount || "")).filter(Boolean));
    const leaf = rows.filter((row) => active(row) && !parentIds.has(String(row.accountId || "")));
    const income = leaf.filter((row) => String(row.accountType || "").toLowerCase() === "income");
    const expense = leaf.filter((row) => String(row.accountType || "").toLowerCase() === "expense");
    const byId = new Map(rows.map((row) => [String(row.accountId || ""), row]));

    let suggestion: Suggestion = heuristic(input.itemName, input.itemType);

    if (env.OPENAI_API_KEY && income.length && expense.length) {
      try {
        const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
        const response = await (client.responses as any).parse({
          model: env.OPENAI_MODEL || "gpt-5-mini",
          input: [{
            role: "user",
            content: [{
              type: "input_text",
              text: [
                "You are the finance-accounting classifier for Easynet IT Solutions Limited in Papua New Guinea.",
                "Choose the most appropriate posting accounts for a new Item Master record based on the item name and item type.",
                "You MUST choose exactly one revenue account from the allowed income list and one cost/COGS account from the allowed expense list. Never invent an account ID.",
                "Stock/hardware normally maps to hardware sales revenue and hardware/materials cost. Services should map to the most specific service revenue and direct-cost account. Cloud/hosting/software/licence/ERP/managed IT/consulting/ICT infrastructure wording should use the closest specific accounts.",
                `Item Name: ${input.itemName}`,
                `Item Type: ${input.itemType}`,
                `Allowed Revenue Accounts: ${income.map((a) => `${a.accountId}|${a.accountName}|${a.accountCode}`).join("; ")}`,
                `Allowed Cost Accounts: ${expense.map((a) => `${a.accountId}|${a.accountName}|${a.accountCode}`).join("; ")}`,
              ].join("\n"),
            }],
          }],
          text: { format: zodTextFormat(aiSchema, "item_account_suggestion") },
        } as any);
        const parsed = aiSchema.parse(response.output_parsed);
        const validRevenue = income.some((row) => String(row.accountId) === parsed.revenueAccountId);
        const validCost = expense.some((row) => String(row.accountId) === parsed.costAccountId);
        if (validRevenue && validCost) suggestion = { ...parsed, source: "AI" };
      } catch {
        // AI failure must never block item creation. Controlled rule fallback remains available.
      }
    }

    return NextResponse.json({
      ok: true,
      suggestion: {
        ...suggestion,
        revenueAccountLabel: accountLabel(byId.get(suggestion.revenueAccountId), suggestion.revenueAccountId),
        costAccountLabel: accountLabel(byId.get(suggestion.costAccountId), suggestion.costAccountId),
      },
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("; ")
      : error instanceof Error ? error.message : "Account suggestion failed";
    return NextResponse.json({ ok: false, error: message }, { status: message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400 });
  }
}
