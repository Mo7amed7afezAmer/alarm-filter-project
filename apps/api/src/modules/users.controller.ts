// User management. Super admin: every account, any role, any office. Office admin: the viewers /
// operators of their own office only (@alarm/core roles.ts). Nobody edits or deletes themselves here.
import { Controller, Delete, Get, Patch, Post, Req } from "@nestjs/common";
import bcrypt from "bcryptjs";
import type { Request } from "express";
import { z } from "zod";
import { canManage, checkAssignment, isSuperAdmin, ROLES, type Account } from "@alarm/core";
import { prisma } from "@alarm/db";
import type { AuthUser } from "../common/auth.js";
import { HttpError, parseBody, searchParams } from "../common/http.js";
import { CurrentUser, Roles } from "../common/nest.js";
import { availableOffices } from "../lib/office.js";

const select = { id: true, email: true, role: true, office: true } as const;
const role = z.enum(ROLES);
const password = z.string().min(8, "at least 8 characters").max(200);
const office = z.string().trim().max(200).nullable().optional();

const actorOf = (user: AuthUser): Account => ({ id: user.id, role: user.role, office: user.office });

async function target(actor: Account, id: number): Promise<Account> {
  const user = await prisma.user.findUnique({ where: { id }, select });
  // 404 (not 403) for accounts outside the admin's office: they do not exist for them.
  if (!user || (!canManage(actor, user) && actor.id !== id)) throw new HttpError(404, "User not found");
  if (actor.id === id) throw new HttpError(400, "You cannot change your own account here");
  return user;
}

async function checkOffice(value: string | null) {
  if (!value) return;
  const offices = await availableOffices();
  if (offices.length && !offices.includes(value))
    throw new HttpError(400, `Unknown office "${value}"`);
}

@Controller("users")
@Roles("ADMIN")
export class UsersController {
  /** Accounts the actor manages (plus themselves, read-only), and what they may assign. */
  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const actor = actorOf(user);
    const users = await prisma.user.findMany({
      where: isSuperAdmin(actor.role) ? {} : { office: actor.office ?? "" },
      select,
      orderBy: [{ office: "asc" }, { email: "asc" }],
    });
    return {
      users: users.filter((u) => u.id === actor.id || canManage(actor, u)),
      offices: isSuperAdmin(actor.role) ? await availableOffices() : actor.office ? [actor.office] : [],
    };
  }

  @Post()
  async create(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const actor = actorOf(user);
    const body = await parseBody(
      req,
      z.object({
        email: z.string().trim().toLowerCase().email(),
        password,
        role: role.default("VIEWER"),
        office,
      }),
    );
    const assigned = checkAssignment(actor, body.role, body.office);
    if ("error" in assigned) throw new HttpError(403, assigned.error);
    await checkOffice(assigned.office);
    if (await prisma.user.findFirst({ where: { email: { equals: body.email, mode: "insensitive" } } })) {
      throw new HttpError(409, "A user with this email already exists");
    }
    const created = await prisma.user.create({
      data: {
        email: body.email,
        role: body.role,
        office: assigned.office,
        passwordHash: await bcrypt.hash(body.password, 12),
      },
      select,
    });
    return { user: created }; // 201 (Nest's default for POST)
  }

  /** Change role / office and/or reset password of a managed account. */
  @Patch()
  async update(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const actor = actorOf(user);
    const body = await parseBody(
      req,
      z.object({ id: z.number().int(), role: role.optional(), office, password: password.optional() }),
    );
    const current = await target(actor, body.id);
    let data: { role?: Account["role"]; office?: string | null } = {};
    if (body.role !== undefined || body.office !== undefined) {
      const nextRole = body.role ?? current.role;
      const assigned = checkAssignment(
        actor,
        nextRole,
        body.office === undefined ? current.office : body.office,
      );
      if ("error" in assigned) throw new HttpError(403, assigned.error);
      await checkOffice(assigned.office);
      data = { role: nextRole, office: assigned.office };
    }
    const updated = await prisma.user.update({
      where: { id: body.id },
      data: {
        ...data,
        ...(body.password ? { passwordHash: await bcrypt.hash(body.password, 12) } : {}),
      },
      select,
    });
    return { user: updated };
  }

  @Delete()
  async remove(@Req() req: Request, @CurrentUser() user: AuthUser) {
    const actor = actorOf(user);
    const id = Number(searchParams(req).get("id"));
    if (!Number.isInteger(id)) throw new HttpError(400, "id required");
    await target(actor, id);
    await prisma.user.delete({ where: { id } });
    return { deleted: id };
  }
}
