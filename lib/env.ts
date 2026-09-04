import { z } from "zod";

const schema = z.object({
  APPS_SCRIPT_WEB_APP_URL: z.string().url().optional(),
  APPS_SCRIPT_API_TOKEN: z.string().min(32).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  APP_SECRET: z.string().optional(),
  ALLOWED_EMAILS: z.string().optional(),
});

export const env = schema.parse(process.env);
