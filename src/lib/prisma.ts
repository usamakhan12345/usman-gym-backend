import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

// Pass the URL explicitly so the client can never pick up a different .env than the one config/env.ts selected
// (e.g. the dev database while running tests).
export const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
