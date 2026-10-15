import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

type Db = Pick<typeof prisma, 'auditLog'>;

export async function audit(
  entry: {
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Prisma.InputJsonValue;
    ip?: string;
  },
  db: Db = prisma,
) {
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
