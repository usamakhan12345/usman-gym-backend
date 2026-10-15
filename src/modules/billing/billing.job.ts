import cron from 'node-cron';
import { env } from '../../config/env';
import { generateMissingFees } from './billing.service';

async function run(trigger: string) {
  try {
    const result = await generateMissingFees();
    console.log(
      `[billing] ${trigger}: checked ${result.membershipsChecked} memberships, created ${result.feesCreated} fees (up to ${result.upTo.year}-${String(result.upTo.month).padStart(2, '0')})`,
    );
  } catch (err) {
    console.error(`[billing] ${trigger} failed`, err);
  }
}

/**
 * Runs a catch-up at startup and then every day shortly after midnight (APP_TIMEZONE).
 * Running daily instead of only on the 1st means a missed run (server down) never skips a month.
 */
export function startBillingJob() {
  void run('startup catch-up');
  cron.schedule('10 0 * * *', () => void run('daily'), { timezone: env.APP_TIMEZONE });
}
