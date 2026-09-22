import { z } from "zod";
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url(),
  SESSION_SECRET: z.string().min(64),
  NODE_ENV: z.string().default("development"),
});
export function config() {
  const c = schema.parse(process.env);
  if (c.NODE_ENV === "production" && !c.APP_URL.startsWith("https://"))
    throw new Error("Production requires HTTPS");
  return c;
}
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function requireCondition(
  ok: unknown,
  status: number,
  code: string,
): asserts ok {
  if (!ok) throw new AppError(status, code);
}
