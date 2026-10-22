// Integration-test harness: the real Nest app on a random port, called over HTTP. The signed-in
// user is `session.current` (a test account id) and travels as a Bearer token, so every request
// goes through the same guard, routing and error filter as production.
import type { INestApplication } from "@nestjs/common";

export interface TestSession {
  user: { id: string };
}

export interface Reply {
  status: number;
  headers: Headers;
  /** Parsed JSON when the response is JSON, else undefined. */
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  raw: Response;
}

export function createHarness() {
  const session = { current: null as TestSession | null };
  let app: INestApplication | undefined;
  let base = "";

  async function start() {
    const { createApp } = await import("../app.js");
    app = await createApp();
    await app.listen(0, "127.0.0.1");
    base = (await app.getUrl()).replace("[::1]", "127.0.0.1");
  }

  async function stop() {
    await app?.close();
  }

  /** fetch() against the app as `session.current` (unless `init.headers` has an Authorization). */
  async function call(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Reply> {
    const headers = new Headers(init.headers);
    if (session.current && !headers.has("authorization")) {
      const { signApiToken } = await import("../common/auth.js");
      const { token } = await signApiToken(Number(session.current.user.id));
      headers.set("authorization", `Bearer ${token}`);
    }
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    const raw = await fetch(base + path, { ...init, headers, body, redirect: "manual" });
    const isJson = raw.headers.get("content-type")?.includes("application/json");
    return {
      status: raw.status,
      headers: raw.headers,
      body: isJson ? await raw.clone().json() : undefined,
      raw,
    };
  }

  const get = (path: string) => call(path);

  return { session, start, stop, call, get };
}
