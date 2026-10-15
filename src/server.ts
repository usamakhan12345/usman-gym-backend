import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { startBillingJob } from './modules/billing/billing.job';

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`Usman Gym API listening on http://localhost:${env.PORT} (${env.NODE_ENV}, OTP provider: ${env.OTP_PROVIDER})`);
  if (env.ENABLE_BILLING_CRON) startBillingJob();
});

const shutdown = () => {
  server.close(() => prisma.$disconnect().finally(() => process.exit(0)));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
