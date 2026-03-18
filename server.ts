import { Hono } from "hono";

import { createConfiguredApp } from "./src/server/configured-app.js";

const app: Hono = createConfiguredApp();

export default app;
