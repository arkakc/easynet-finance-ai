import { z } from "zod";

const optionalUrl = z.string().url().optional();
const optionalToken = z.string().min(32).optional();

const schema = z.object({
  // Legacy single Apps Script backend. Kept as a safe fallback during migration.
  APPS_SCRIPT_WEB_APP_URL: optionalUrl,
  APPS_SCRIPT_API_TOKEN: optionalToken,

  // v0.4 split backend services.
  CORE_APPS_SCRIPT_WEB_APP_URL: optionalUrl,
  CORE_APPS_SCRIPT_API_TOKEN: optionalToken,
  REPORTING_APPS_SCRIPT_WEB_APP_URL: optionalUrl,
  REPORTING_APPS_SCRIPT_API_TOKEN: optionalToken,
  DOCUMENT_APPS_SCRIPT_WEB_APP_URL: optionalUrl,
  DOCUMENT_APPS_SCRIPT_API_TOKEN: optionalToken,

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  APP_SECRET: z.string().optional(),
  ALLOWED_EMAILS: z.string().optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  ERP_USERS_JSON: z.string().optional(),
});

export const env = schema.parse(process.env);
