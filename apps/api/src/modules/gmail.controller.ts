// Connecting the alarm mailbox from /settings/gmail (super admin). See lib/gmailConnect.ts.
import { existsSync } from "node:fs";
import { Controller, Delete, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { loadGmailClient, prisma } from "@alarm/db";
import { authenticate, readCookie, requireRole, type AuthUser } from "../common/auth.js";
import { HttpError, parseBody, publicUrl, readText } from "../common/http.js";
import { CurrentUser, Public, Roles } from "../common/nest.js";
import { gmailFiles } from "../lib/gmail.js";
import {
  checkConnection,
  cookieOptions,
  FLOW_COOKIE,
  finishFlow,
  maskClientId,
  parseReturnedUrl,
  readFlow,
  redirectFor,
  saveClient,
  startFlow,
} from "../lib/gmailConnect.js";

const MAX_CLIENT_BYTES = 20_000;

const startBody = z.object({
  loginHint: z.string().trim().email().max(200).optional().or(z.literal("")),
});

const clearFlowCookie = (res: Response) =>
  res.clearCookie(FLOW_COOKIE, { path: cookieOptions.path });

@Controller("gmail")
export class GmailController {
  /** Connection status; never returns the token or the secret. */
  @Get("account")
  @Roles("SUPER_ADMIN")
  async account(@Req() req: Request) {
    const files = gmailFiles();
    const [row, status, client] = await Promise.all([
      prisma.gmailAccount.findUnique({ where: { id: 1 } }),
      prisma.systemStatus.findUnique({ where: { id: 1 } }),
      loadGmailClient(prisma, files.credentialsPath).catch(() => null),
    ]);
    const tokenFile = !!files.tokenPath && existsSync(files.tokenPath);
    return {
      data: {
        client: client
          ? { source: client.source, clientId: maskClientId(client.clientId) }
          : { source: "none" as const, clientId: null },
        token: row?.refreshToken
          ? {
              source: "db" as const,
              email: row.email,
              scope: row.scope,
              connectedAt: row.connectedAt,
              connectedBy: row.connectedBy,
            }
          : { source: tokenFile ? ("file" as const) : ("none" as const), email: null, scope: null, connectedAt: null, connectedBy: null },
        lastCheck: row?.lastCheckAt
          ? { at: row.lastCheckAt, ok: row.lastCheckOk, message: row.lastCheckMsg }
          : null,
        worker: { lastRunAt: status?.lastRunAt ?? null, lastError: status?.lastError ?? null },
        redirect: redirectFor(publicUrl(req)),
      },
    };
  }

  /** Forget the UI-connected token (the worker falls back to token.json if any). */
  @Delete("account")
  @Roles("SUPER_ADMIN")
  async disconnect() {
    await prisma.gmailAccount.updateMany({
      where: { id: 1 },
      data: { refreshToken: null, email: null, scope: null, connectedAt: null, connectedBy: null },
    });
    return { data: { disconnected: true } };
  }

  /** Test the connection with users.getProfile. */
  @Post("check")
  @Roles("SUPER_ADMIN")
  @HttpCode(200)
  async check() {
    return { data: await checkConnection() };
  }

  /** Upload the Google "Desktop app" client (credentials.json content as JSON). */
  @Post("client")
  @Roles("SUPER_ADMIN")
  @HttpCode(200)
  async uploadClient(@Req() req: Request) {
    const text = await readText(req);
    if (text.length > MAX_CLIENT_BYTES) throw new HttpError(413, "File too large for a credentials.json");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new HttpError(400, "Not a JSON file");
    }
    return { data: await saveClient(json) };
  }

  /** Go back to credentials.json on disk. */
  @Delete("client")
  @Roles("SUPER_ADMIN")
  async removeClient() {
    await prisma.gmailAccount.updateMany({
      where: { id: 1 },
      data: { clientId: null, clientSecret: null },
    });
    return { data: { removed: true } };
  }

  /** {loginHint?} → { authUrl, redirectUri, loopback }. PKCE verifier + state live in an
   *  httpOnly cookie for 10 minutes. */
  @Post("oauth/start")
  @Roles("SUPER_ADMIN")
  @HttpCode(200)
  async start(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { loginHint } = await parseBody(req, startBody);
    const { authUrl, redirectUri, loopback, flow } = await startFlow(
      publicUrl(req),
      loginHint || undefined,
    );
    res.cookie(FLOW_COOKIE, JSON.stringify(flow), {
      ...cookieOptions,
      maxAge: cookieOptions.maxAge * 1000, // Express: ms
    });
    return { data: { authUrl, redirectUri, loopback } };
  }

  /** {url} — finish the flow from the address Google redirected to (app opened over the LAN). */
  @Post("oauth/complete")
  @Roles("SUPER_ADMIN")
  @HttpCode(200)
  async complete(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthUser,
  ) {
    const { url } = await parseBody(req, z.object({ url: z.string().trim().min(10).max(4000) }));
    const flow = readFlow(readCookie(req, FLOW_COOKIE));
    const result = await finishFlow(flow, parseReturnedUrl(url), user.email);
    clearFlowCookie(res);
    return { data: result };
  }

  /** Google redirects here when the page is opened on the host (loopback). Finishes the flow
   *  and returns to /settings/gmail with the result — errors go there too, never as JSON. */
  @Get("oauth/callback")
  @Public()
  async callback(@Req() req: Request, @Res() res: Response) {
    const url = publicUrl(req);
    const back = new URL("/settings/gmail", url);
    try {
      const user = requireRole(await authenticate(req), "SUPER_ADMIN");
      const flow = readFlow(readCookie(req, FLOW_COOKIE));
      const { email } = await finishFlow(flow, parseReturnedUrl(url), user.email);
      back.searchParams.set("connected", email);
    } catch (err) {
      back.searchParams.set(
        "error",
        err instanceof HttpError ? err.message : "Could not finish the Gmail sign-in",
      );
      if (!(err instanceof HttpError)) console.error("gmail oauth callback:", err);
    }
    clearFlowCookie(res);
    res.redirect(307, back.toString());
  }
}
