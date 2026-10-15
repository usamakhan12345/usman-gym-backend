"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const env_1 = require("./config/env");
const prisma_1 = require("./lib/prisma");
const billing_job_1 = require("./modules/billing/billing.job");
const app = (0, app_1.createApp)();
const server = app.listen(env_1.env.PORT, () => {
    console.log(`Usman Gym API listening on http://localhost:${env_1.env.PORT} (${env_1.env.NODE_ENV}, OTP provider: ${env_1.env.OTP_PROVIDER})`);
    if (env_1.env.ENABLE_BILLING_CRON)
        (0, billing_job_1.startBillingJob)();
});
const shutdown = () => {
    server.close(() => prisma_1.prisma.$disconnect().finally(() => process.exit(0)));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
