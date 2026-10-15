"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.audit = audit;
const prisma_1 = require("./prisma");
async function audit(entry, db = prisma_1.prisma) {
    await db.auditLog.create({
        data: {
            actorId: entry.actorId ?? null,
            action: entry.action,
            entityType: entry.entityType,
            entityId: entry.entityId ?? null,
            metadata: entry.metadata,
            ip: entry.ip,
        },
    });
}
