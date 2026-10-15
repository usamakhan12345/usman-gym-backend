"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.monthLabel = exports.addMonths = exports.compareYm = exports.ymd = exports.todayDateOnly = exports.dateOnly = exports.currentYearMonth = void 0;
exports.nowInAppTz = nowInAppTz;
exports.parseDateOnly = parseDateOnly;
exports.monthsBetween = monthsBetween;
const env_1 = require("../config/env");
function nowInAppTz(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: env_1.env.APP_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    return { year: get('year'), month: get('month'), day: get('day') };
}
const currentYearMonth = (now) => {
    const { year, month } = nowInAppTz(now);
    return { year, month };
};
exports.currentYearMonth = currentYearMonth;
/** Date-only (UTC midnight) value for a calendar day. */
const dateOnly = (year, month, day) => new Date(Date.UTC(year, month - 1, day));
exports.dateOnly = dateOnly;
const todayDateOnly = (now) => {
    const { year, month, day } = nowInAppTz(now);
    return (0, exports.dateOnly)(year, month, day);
};
exports.todayDateOnly = todayDateOnly;
const ymd = (d) => (d ? d.toISOString().slice(0, 10) : null);
exports.ymd = ymd;
/** Parse "YYYY-MM-DD" into a date-only value, or null if not a real calendar date. */
function parseDateOnly(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m)
        return null;
    const d = (0, exports.dateOnly)(Number(m[1]), Number(m[2]), Number(m[3]));
    return (0, exports.ymd)(d) === value ? d : null;
}
const compareYm = (a, b) => a.year * 12 + a.month - (b.year * 12 + b.month);
exports.compareYm = compareYm;
const addMonths = (ym, n) => {
    const idx = ym.year * 12 + (ym.month - 1) + n;
    return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
};
exports.addMonths = addMonths;
function monthsBetween(from, to) {
    const out = [];
    for (let cur = from; (0, exports.compareYm)(cur, to) <= 0; cur = (0, exports.addMonths)(cur, 1))
        out.push(cur);
    return out;
}
const monthLabel = (year, month) => new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
exports.monthLabel = monthLabel;
