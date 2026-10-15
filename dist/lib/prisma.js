"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const env_1 = require("../config/env");
// Pass the URL explicitly so the client can never pick up a different .env than the one config/env.ts selected
// (e.g. the dev database while running tests).
exports.prisma = new client_1.PrismaClient({ datasourceUrl: env_1.env.DATABASE_URL });
