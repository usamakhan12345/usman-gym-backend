"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBillingJob = startBillingJob;
const node_cron_1 = __importDefault(require("node-cron"));
const env_1 = require("../../config/env");
const billing_service_1 = require("./billing.service");
async function run(trigger) {
    try {
        const result = await (0, billing_service_1.generateMissingFees)();
        console.log(`[billing] ${trigger}: checked ${result.membershipsChecked} memberships, created ${result.feesCreated} fees (up to ${result.upTo.year}-${String(result.upTo.month).padStart(2, '0')})`);
    }
    catch (err) {
        console.error(`[billing] ${trigger} failed`, err);
    }
}
/**
 * Runs a catch-up at startup and then every day shortly after midnight (APP_TIMEZONE).
 * Running daily instead of only on the 1st means a missed run (server down) never skips a month.
 */
function startBillingJob() {
    void run('startup catch-up');
    node_cron_1.default.schedule('10 0 * * *', () => void run('daily'), { timezone: env_1.env.APP_TIMEZONE });
}
