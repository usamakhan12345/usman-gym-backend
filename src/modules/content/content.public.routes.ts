import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok, validate } from '../../lib/http';
import { emailSchema, phoneSchema } from '../../lib/identity';
import { prisma } from '../../lib/prisma';
import { contactLimiter } from '../../middleware/rateLimit';
import { getPublicSite } from './content.service';

export const publicRouter = Router();

publicRouter.get(
  '/site',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    ok(res, await getPublicSite());
  }),
);

const contactSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: emailSchema,
    phone: z.union([phoneSchema, z.literal('').transform(() => undefined)]).optional(),
    message: z.string().trim().min(10, 'Please write at least 10 characters').max(2000),
  })
  .strict();

publicRouter.post(
  '/contact',
  contactLimiter,
  validate({ body: contactSchema }),
  asyncHandler(async (req, res) => {
    await prisma.contactMessage.create({ data: req.body });
    ok(res, { message: 'Thanks! Your message has been sent. We will get back to you soon.' }, 201);
  }),
);
