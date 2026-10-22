// Nest glue: the global auth guard, @Public / @Roles / @CurrentUser, and the error filter that
// keeps the API's JSON error shape ({ error, details? }).
import {
  type ArgumentsHost,
  Catch,
  type CanActivate,
  createParamDecorator,
  type ExceptionFilter,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import type { Role } from "@alarm/core";
import { authenticate, requireRole, type AuthUser } from "./auth.js";
import { HttpError } from "./http.js";

const PUBLIC = "alarm:public";
const ROLE = "alarm:role";

/** No sign-in needed (health, token, the Gmail OAuth callback that handles auth itself). */
export const Public = () => SetMetadata(PUBLIC, true);
/** Minimum role (VIEWER < OPERATOR < ADMIN < SUPER_ADMIN). Without it: any signed-in user. */
export const Roles = (role: Role) => SetMetadata(ROLE, role);

type AuthedRequest = Request & { user?: AuthUser };

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw new HttpError(401, "Not signed in");
    return user;
  },
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    req.user = requireRole(
      await authenticate(req),
      this.reflector.getAllAndOverride<Role | undefined>(ROLE, targets),
    );
    return true;
  }
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    if (err instanceof HttpException) {
      // Nest's own (unknown route → 404, …)
      res.status(err.getStatus()).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
}
