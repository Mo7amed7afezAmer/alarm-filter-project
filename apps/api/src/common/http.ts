// Shared helpers for controllers: errors, zod query/body parsing, pagination.
// Bodies are read here (Nest's body parser is off, see main.ts) so every route keeps the exact
// parsing and error messages it had as a Next.js Route Handler.
import { Readable } from "node:stream";
import type { Request } from "express";
import { z, type ZodTypeAny } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Address the client used (scheme://host/path?query). Behind the Next.js rewrite the original
 * host is in X-Forwarded-Host / -Proto; the proxy appends its value last.
 */
export function publicUrl(req: Request): string {
  const last = (h: string | string[] | undefined) =>
    (Array.isArray(h) ? h.join(",") : h)?.split(",").pop()?.trim() || undefined;
  const proto = last(req.headers["x-forwarded-proto"]) ?? req.protocol;
  const host = last(req.headers["x-forwarded-host"]) ?? req.headers.host ?? "localhost";
  return `${proto}://${host}${req.originalUrl}`;
}

export function searchParams(req: Request): URLSearchParams {
  return new URL(req.originalUrl, "http://x").searchParams;
}

/** Web Fetch API view of the request body (json / text / formData parse like Route Handlers). */
function webRequest(req: Request): globalThis.Request {
  return new globalThis.Request(publicUrl(req), {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: Readable.toWeb(req) as ReadableStream,
    duplex: "half",
  } as RequestInit);
}

export const readText = (req: Request): Promise<string> => webRequest(req).text();

export async function readForm(req: Request): Promise<FormData> {
  return webRequest(req).formData();
}

export function parseQuery<T extends ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  const params = Object.fromEntries(searchParams(req));
  const r = schema.safeParse(params);
  if (!r.success) throw new HttpError(400, "Invalid query", r.error.flatten().fieldErrors);
  return r.data;
}

export async function parseBody<T extends ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await webRequest(req).json();
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
  const r = schema.safeParse(json);
  if (!r.success) throw new HttpError(400, "Invalid body", r.error.flatten());
  return r.data;
}

// ---- common query schemas ----

export const category = z.enum(["DOWN", "POWER", "OTHER"]);

export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
};

/** Accepts YYYY-MM-DD (start of that day in ALARM_TZ is NOT applied — UTC midnight) or ISO. */
export const dateParam = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "invalid date")
  .transform((s) => new Date(s));

export function paged<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export const ALARM_TZ = process.env.ALARM_TZ || "Africa/Cairo";
