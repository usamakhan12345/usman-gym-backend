"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const env_1 = require("./config/env");
const upload_1 = require("./lib/upload");
const error_1 = require("./middleware/error");
const admin_routes_1 = require("./modules/admin/admin.routes");
const auth_routes_1 = require("./modules/auth/auth.routes");
const content_public_routes_1 = require("./modules/content/content.public.routes");
const member_routes_1 = require("./modules/member/member.routes");
function createApp() {
    const app = (0, express_1.default)();
    app.set('trust proxy', 1); // behind the Next.js proxy / a reverse proxy: use the real client IP for rate limits
    app.disable('x-powered-by');
    app.use((0, helmet_1.default)({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
    app.use((0, cors_1.default)({
        origin: env_1.env.FRONTEND_URL.split(',').map((s) => s.trim()),
        credentials: true,
    }));
    app.use(express_1.default.json({ limit: '100kb' }));
    app.use((0, cookie_parser_1.default)());
    if (!env_1.isTest)
        app.use((req, _res, next) => (console.log(`${req.method} ${req.originalUrl}`), next()));
    // Only the profile image folder is served, never the whole upload directory.
    app.use('/uploads/profiles', express_1.default.static(upload_1.PROFILE_PUBLIC_DIR, { index: false, dotfiles: 'deny', maxAge: '1h' }));
    app.get('/api/health', (_req, res) => res.json({ success: true, data: { status: 'ok' } }));
    app.use('/api/auth', auth_routes_1.authRouter);
    app.use('/api/public', content_public_routes_1.publicRouter);
    app.use('/api/member', member_routes_1.memberRouter);
    app.use('/api/admin', admin_routes_1.adminRouter);
    app.use(error_1.notFoundHandler);
    app.use(error_1.errorHandler);
    return app;
}
