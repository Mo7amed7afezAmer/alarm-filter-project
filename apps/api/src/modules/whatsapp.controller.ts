// WhatsApp sending through the sender service. Every account except viewers links its OWN
// number and sends from it (user request 2026-10-29).
//   GET  /api/whatsapp/status?start=1  the user's link state (viewers: never linked); start =
//                                      show a QR when no number is linked (settings page)
//   POST /api/whatsapp/logout          operator+ — unlinks the user's own number
//   POST /api/whatsapp/send            operator+ — {chat, text?, images?: [{name, data}]}; chat
//                                      must be one of the user's saved chats; every send is logged
//   GET  /api/whatsapp/sends           operator+ — the last 100 sends (super admin: everyone's)
import { Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { hasRole, normalizeWhatsAppTarget } from "@alarm/core";
import { prisma } from "@alarm/db";
import type { AuthUser } from "../common/auth.js";
import { HttpError, readText, searchParams } from "../common/http.js";
import { CurrentUser, Roles } from "../common/nest.js";
import { savedChats, senderLogout, senderSend, senderStatus } from "../lib/whatsapp.js";

/** 30 PNGs of ≤ 5 MB as base64 (the sender checks the exact limits). */
const MAX_BODY_CHARS = 210 * 1024 * 1024;

@Controller("whatsapp")
export class WhatsAppController {
  @Get("status")
  async status(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const canSend = hasRole(user.role, "OPERATOR");
    if (!canSend)
      return { data: { state: "disconnected", qr: null, me: null, error: null, canSend } };
    const s = await senderStatus(user.id, {
      start: searchParams(req).get("start") === "1",
      // the number linked before per-user sending belongs to the super admin
      adopt: user.role === "SUPER_ADMIN",
    });
    return { data: { ...s, canSend } };
  }

  @Post("logout")
  @Roles("OPERATOR")
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser) {
    await senderLogout(user.id);
    return { data: { ok: true } };
  }

  @Post("send")
  @Roles("OPERATOR")
  @HttpCode(200)
  async send(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const raw = await readText(req);
    if (raw.length > MAX_BODY_CHARS) throw new HttpError(413, "Too many or too large images");
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "Body must be JSON");
    }
    const chat = typeof body.chat === "string" ? normalizeWhatsAppTarget(body.chat) : "";
    if (!chat) throw new HttpError(400, "chat must be a WhatsApp number or group link");
    const me = await prisma.user.findUnique({ where: { id: user.id }, select: { uiPrefs: true } });
    if (!savedChats(me?.uiPrefs).has(chat))
      throw new HttpError(403, "Send only to a chat saved in your share settings");

    const text = typeof body.text === "string" ? body.text : undefined;
    const images = Array.isArray(body.images)
      ? (body.images as { name: string; data: string }[])
      : undefined;
    const log = {
      userId: user.id,
      userEmail: user.email,
      chat,
      texts: text?.trim() ? 1 : 0,
      images: images?.length ?? 0,
    };
    try {
      const r = await senderSend(user.id, { chat, text, images });
      await prisma.whatsappSend.create({ data: { ...log, chatName: r.chat, ok: true } });
      return { data: r };
    } catch (e) {
      await prisma.whatsappSend.create({
        data: { ...log, ok: false, error: (e as Error).message.slice(0, 500) },
      });
      throw e;
    }
  }

  @Get("sends")
  @Roles("OPERATOR")
  async sends(@CurrentUser() user: AuthUser) {
    const rows = await prisma.whatsappSend.findMany({
      where: user.role === "SUPER_ADMIN" ? {} : { userId: user.id },
      orderBy: { id: "desc" },
      take: 100,
    });
    return { data: rows };
  }
}
