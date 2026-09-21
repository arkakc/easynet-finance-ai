import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { companyBaseCurrency, normalizeCurrency, roundExchangeRate } from "@/lib/accounting/currency";
import { prisma } from "@/src/lib/prisma";

const rateSchema = z.object({
  rateDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  fromCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  toCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional().default(""),
  rate: z.coerce.number().finite().positive(),
  source: z.string().trim().max(80).optional().default("MANUAL"),
  notes: z.string().trim().max(500).optional().default(""),
});

export async function GET(request: Request) {
  try {
    await requirePermission("accounts.read");
    const url = new URL(request.url);
    const fromCurrency = String(url.searchParams.get("fromCurrency") || "").trim().toUpperCase();
    const toCurrency = String(url.searchParams.get("toCurrency") || "").trim().toUpperCase();
    const baseCurrency = await prisma.$transaction((tx) => companyBaseCurrency(tx));

    const rows = await prisma.exchangeRate.findMany({
      where: {
        ...(fromCurrency ? { fromCurrency } : {}),
        ...(toCurrency ? { toCurrency } : {}),
      },
      orderBy: [{ rateDate: "desc" }, { fromCurrency: "asc" }, { toCurrency: "asc" }],
      take: 500,
    });

    return NextResponse.json({
      ok: true,
      baseCurrency,
      rateConvention: "1 FROM currency = rate TO currency",
      rates: rows.map((row) => ({
        rateId: row.id,
        rateDate: row.rateDate.toISOString().slice(0, 10),
        fromCurrency: row.fromCurrency,
        toCurrency: row.toCurrency,
        rate: Number(row.rate),
        source: row.source,
        isManual: row.isManual,
        notes: row.notes || "",
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Exchange rate read failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission("accounts.write");
    const input = rateSchema.parse(await request.json());
    const baseCurrency = await prisma.$transaction((tx) => companyBaseCurrency(tx));
    const fromCurrency = normalizeCurrency(input.fromCurrency);
    const toCurrency = normalizeCurrency(input.toCurrency || baseCurrency);
    if (fromCurrency === toCurrency) {
      throw new Error("Exchange-rate currencies must be different. Base-currency documents use rate 1 automatically.");
    }

    const rateDate = new Date(`${input.rateDate}T00:00:00+10:00`);
    const rate = roundExchangeRate(input.rate);

    const saved = await prisma.exchangeRate.upsert({
      where: {
        rateDate_fromCurrency_toCurrency: {
          rateDate,
          fromCurrency,
          toCurrency,
        },
      },
      create: {
        rateDate,
        fromCurrency,
        toCurrency,
        rate,
        source: input.source || "MANUAL",
        isManual: true,
        notes: input.notes || null,
        createdBy: user.email,
      },
      update: {
        rate,
        source: input.source || "MANUAL",
        isManual: true,
        notes: input.notes || null,
      },
    });

    return NextResponse.json({
      ok: true,
      baseCurrency,
      rate: {
        rateId: saved.id,
        rateDate: saved.rateDate.toISOString().slice(0, 10),
        fromCurrency: saved.fromCurrency,
        toCurrency: saved.toCurrency,
        rate: Number(saved.rate),
        source: saved.source,
        notes: saved.notes || "",
      },
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.errors.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("; ")
      : error instanceof Error ? error.message : "Exchange rate save failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400 },
    );
  }
}
