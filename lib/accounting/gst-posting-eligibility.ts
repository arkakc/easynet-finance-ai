import { prisma } from "@/src/lib/prisma";

export type GstPostingEvidence = {
  status: string;
  registrationNumberPresent: boolean;
  certificateRetained: boolean;
};

/**
 * REGISTERED is the taxpayer's registration status. VERIFIED is the legacy
 * internal approval status. Both require real registration evidence to post GST.
 */
export function mayPostGst(evidence: GstPostingEvidence): boolean {
  return ["REGISTERED", "VERIFIED"].includes(evidence.status.trim().toUpperCase())
    && evidence.registrationNumberPresent
    && evidence.certificateRetained;
}

export async function assertGstPostingAuthorized(): Promise<void> {
  const [settings, certificate] = await Promise.all([
    prisma.globalSettings.findMany({
      where: { key: { in: ["gst_status", "gst_number", "company_tin"] } },
      select: { key: true, value: true },
    }),
    prisma.document.findFirst({
      where: {
        documentType: "GST_REGISTRATION",
        status: { not: "REJECTED" },
        fileUrl: { not: null },
      },
      select: { id: true },
    }),
  ]);
  const values = new Map(settings.map((row) => [row.key, String(row.value || "").trim()]));
  if (!mayPostGst({
    status: values.get("gst_status") || "",
    registrationNumberPresent: Boolean(values.get("gst_number") || values.get("company_tin")),
    certificateRetained: Boolean(certificate),
  })) {
    throw new Error("Input/output GST posting requires REGISTERED or VERIFIED GST status, a recorded GST/TIN number, and a retained GST_REGISTRATION certificate. Review Company Setup → GST.");
  }
}
