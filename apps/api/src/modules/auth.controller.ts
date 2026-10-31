// Public endpoints: health (Docker healthcheck) and the mobile sign-in that issues Bearer tokens.
// Web sign-in stays NextAuth (/api/auth/* in apps/web); both check the same users table.
import { Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@alarm/db";
import { signApiToken } from "../common/auth.js";
import { HttpError, parseBody } from "../common/http.js";
import { Public } from "../common/nest.js";

const WORKER_STALE_SEC = 300;

const tokenBody = z.object({
  email: z.string().trim().max(200),
  password: z.string().max(200),
});

@Controller()
@Public()
export class AuthController {
  /** 200 when the DB answers; worker staleness is reported in the body but does not fail. */
  @Get("health")
  async health(@Res({ passthrough: true }) res: Response) {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      res.status(503);
      return { ok: false, db: "down" };
    }
    const s = await prisma.systemStatus.findUnique({ where: { id: 1 } });
    const ageSec = s?.lastRunAt ? Math.round((Date.now() - s.lastRunAt.getTime()) / 1000) : null;
    const workerOk = ageSec !== null && ageSec <= WORKER_STALE_SEC && !s?.lastError;
    return {
      ok: true,
      db: "ok",
      worker: {
        ok: workerOk,
        lastRunAt: s?.lastRunAt ?? null,
        lastRunAgeSec: ageSec,
        lastError: s?.lastError ?? null,
      },
    };
  }

  /** Mobile sign-in: {email, password} → Bearer token (30 days). Same check as the web login. */
  @Post("auth/token")
  @HttpCode(200)
  async token(@Req() req: Request) {
    const body = await parseBody(req, tokenBody);
    const email = body.email.toLowerCase();
    const user =
      email && body.password
        ? await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } })
        : null;
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash)))
      throw new HttpError(401, "Invalid email or password");
    const { token, expiresAt } = await signApiToken(user.id);
    return {
      token,
      tokenType: "Bearer",
      expiresAt,
      user: { id: user.id, email: user.email, role: user.role, office: user.office },
    };
  }
}
