// REST API entry point (NestJS). Internal port 4100; the web container proxies /api/* to it.
import { createApp } from "./app.js";

const port = Number(process.env.API_PORT) || 4100;
const app = await createApp();
app.enableShutdownHooks();
await app.listen(port, process.env.API_HOST || "0.0.0.0");
console.log(`api listening on :${port}`);
