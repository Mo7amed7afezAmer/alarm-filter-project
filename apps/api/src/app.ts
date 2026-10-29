// The Nest application: every REST endpoint under /api (same paths the Next.js Route Handlers
// had). Used by main.ts and by the integration tests.
import "reflect-metadata";
import { type INestApplication, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, NestFactory } from "@nestjs/core";
import { AuthGuard, ErrorFilter } from "./common/nest.js";
import { AlarmsController } from "./modules/alarms.controller.js";
import { AuthController } from "./modules/auth.controller.js";
import { GmailController } from "./modules/gmail.controller.js";
import { HourlyController } from "./modules/hourly.controller.js";
import { MeController } from "./modules/me.controller.js";
import { SettingsController } from "./modules/settings.controller.js";
import { SiteMasterController } from "./modules/site-master.controller.js";
import { StatsController } from "./modules/stats.controller.js";
import { UsersController } from "./modules/users.controller.js";
import { WhatsAppController } from "./modules/whatsapp.controller.js";

@Module({
  controllers: [
    AuthController,
    AlarmsController,
    StatsController,
    SettingsController,
    MeController,
    UsersController,
    GmailController,
    HourlyController,
    SiteMasterController,
    WhatsAppController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}

export async function createApp(): Promise<INestApplication> {
  // Body parsing is done per route (common/http.ts) to keep each route's exact error messages.
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: ["error", "warn"] });
  app.setGlobalPrefix("api");
  // The mobile app calls with a Bearer token (no cookies), so any origin may read responses.
  app.enableCors({ origin: true, credentials: false });
  // Behind the Next.js rewrite / Cloudflare tunnel: req.protocol from X-Forwarded-Proto.
  (app.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void }).set(
    "trust proxy",
    true,
  );
  return app;
}
