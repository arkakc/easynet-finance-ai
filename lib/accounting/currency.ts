import type { Prisma } from "@prisma/client";

export type CurrencyTx = Prisma.TransactionClient;

export const DEFAULT_BASE_CURRENCY = "PGK";

export const roundCurrency = (value: number) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const roundExchangeRate = (value: number) =>
  Math.round((Number(value) + Number.EPSILON) * 100_000_000) / 100_000_000;

export function normalizeCurrency(value: unknown, fallback = DEFAULT_BASE_CURRENCY) {
  const code = String(value || fallback).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error(`Invalid currency code: ${code || "(blank)"}`);
  return code;
}

export async function companyBaseCurrency(tx: CurrencyTx) {
  const row = await tx.globalSettings.findUnique({ where: { key: "currency" } });
  return normalizeCurrency(row?.value || DEFAULT_BASE_CURRENCY);
}

export function requireExchangeRate(
  transactionCurrency: string,
  baseCurrency: string,
  exchangeRate: unknown,
) {
  const transaction = normalizeCurrency(transactionCurrency);
  const base = normalizeCurrency(baseCurrency);
  if (transaction === base) return 1;
  const rate = Number(exchangeRate || 0);
  if (!Number.isFinite(rate) || !(rate > 0)) {
    throw new Error(
      `Exchange rate is required for ${transaction}/${base}. Rate convention: 1 ${transaction} = rate ${base}.`,
    );
  }
  return roundExchangeRate(rate);
}

export function toBaseAmount(
  amount: number,
  transactionCurrency: string,
  baseCurrency: string,
  exchangeRate: number,
) {
  const transaction = normalizeCurrency(transactionCurrency);
  const base = normalizeCurrency(baseCurrency);
  const rate = requireExchangeRate(transaction, base, exchangeRate);
  return roundCurrency(transaction === base ? amount : Number(amount || 0) * rate);
}

export function fromBaseAmount(
  baseAmount: number,
  transactionCurrency: string,
  baseCurrency: string,
  exchangeRate: number,
) {
  const transaction = normalizeCurrency(transactionCurrency);
  const base = normalizeCurrency(baseCurrency);
  const rate = requireExchangeRate(transaction, base, exchangeRate);
  return roundCurrency(transaction === base ? baseAmount : Number(baseAmount || 0) / rate);
}

export async function latestExchangeRate(
  tx: CurrencyTx,
  input: {
    fromCurrency: string;
    toCurrency: string;
    rateDate: string | Date;
  },
) {
  const fromCurrency = normalizeCurrency(input.fromCurrency);
  const toCurrency = normalizeCurrency(input.toCurrency);
  if (fromCurrency === toCurrency) return 1;

  const rateDate = input.rateDate instanceof Date
    ? input.rateDate
    : new Date(`${String(input.rateDate).slice(0, 10)}T23:59:59+10:00`);

  const direct = await tx.exchangeRate.findFirst({
    where: {
      fromCurrency,
      toCurrency,
      rateDate: { lte: rateDate },
    },
    orderBy: [{ rateDate: "desc" }, { createdAt: "desc" }],
  });
  if (direct) return roundExchangeRate(Number(direct.rate));

  const inverse = await tx.exchangeRate.findFirst({
    where: {
      fromCurrency: toCurrency,
      toCurrency: fromCurrency,
      rateDate: { lte: rateDate },
    },
    orderBy: [{ rateDate: "desc" }, { createdAt: "desc" }],
  });
  if (inverse) {
    const value = Number(inverse.rate || 0);
    if (!(value > 0)) throw new Error("Stored inverse exchange rate is invalid");
    return roundExchangeRate(1 / value);
  }

  throw new Error(
    `No exchange rate found for ${fromCurrency}/${toCurrency} on or before ${rateDate.toISOString().slice(0, 10)}`,
  );
}

export async function resolveDocumentExchangeRate(
  tx: CurrencyTx,
  input: {
    currency: string;
    exchangeRate?: number | null;
    postingDate: string | Date;
  },
) {
  const baseCurrency = await companyBaseCurrency(tx);
  const currency = normalizeCurrency(input.currency, baseCurrency);

  if (currency === baseCurrency) {
    return { currency, baseCurrency, exchangeRate: 1 };
  }

  const explicit = Number(input.exchangeRate || 0);
  const exchangeRate = explicit > 0
    ? requireExchangeRate(currency, baseCurrency, explicit)
    : await latestExchangeRate(tx, {
        fromCurrency: currency,
        toCurrency: baseCurrency,
        rateDate: input.postingDate,
      });

  return { currency, baseCurrency, exchangeRate };
}

export function assertSettlementCurrency(
  paymentCurrency: string,
  documentCurrency: string,
) {
  const payment = normalizeCurrency(paymentCurrency);
  const document = normalizeCurrency(documentCurrency);
  if (payment !== document) {
    throw new Error(
      `Cross-currency allocation is not permitted without an explicit conversion document. Payment is ${payment}; document is ${document}.`,
    );
  }
}

export function realizedFxForSettlement(input: {
  direction: "RECEIVABLE" | "PAYABLE";
  transactionAmount: number;
  documentExchangeRate: number;
  settlementExchangeRate: number;
}) {
  const documentBase = roundCurrency(Number(input.transactionAmount || 0) * Number(input.documentExchangeRate || 0));
  const settlementBase = roundCurrency(Number(input.transactionAmount || 0) * Number(input.settlementExchangeRate || 0));
  const difference = roundCurrency(settlementBase - documentBase);

  if (input.direction === "RECEIVABLE") {
    return {
      documentBase,
      settlementBase,
      gain: difference > 0 ? difference : 0,
      loss: difference < 0 ? Math.abs(difference) : 0,
      signed: difference,
    };
  }

  return {
    documentBase,
    settlementBase,
    gain: difference < 0 ? Math.abs(difference) : 0,
    loss: difference > 0 ? difference : 0,
    signed: roundCurrency(-difference),
  };
}
