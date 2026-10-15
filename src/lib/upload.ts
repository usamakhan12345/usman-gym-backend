import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { env, uploadRoot } from '../config/env';
import { badRequest } from './errors';

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 0 },
}).single('image');

/** Detect the real image type from magic bytes — never trust the client's mimetype or filename. */
function detectImage(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

const PROFILE_DIR = 'profiles';

/** Saves a validated profile image under a random name and returns the stored relative file name. */
export async function saveProfileImage(file: Express.Multer.File | undefined): Promise<string> {
  if (!file) throw badRequest('Please choose an image to upload');
  const ext = detectImage(file.buffer);
  if (!ext) throw badRequest('Only JPEG, PNG or WebP images are allowed');
  const name = `${crypto.randomUUID()}.${ext}`;
  await fs.mkdir(path.join(uploadRoot, PROFILE_DIR), { recursive: true });
  await fs.writeFile(path.join(uploadRoot, PROFILE_DIR, name), file.buffer);
  return name;
}

export async function deleteProfileImage(name: string | null | undefined) {
  if (!name || name !== path.basename(name)) return;
  await fs.rm(path.join(uploadRoot, PROFILE_DIR, name), { force: true });
}

export const profileImageUrl = (name: string | null | undefined) => (name ? `/uploads/${PROFILE_DIR}/${name}` : null);
export const PROFILE_PUBLIC_DIR = path.join(uploadRoot, PROFILE_DIR);

// ---------------------------------------------------------------- payment proofs (PRIVATE files)
// Never served statically: they are streamed only through authenticated owner/admin routes.
const PROOF_DIR = 'proofs';
export const PROOF_ROOT = path.join(uploadRoot, PROOF_DIR);

export const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_PROOF_UPLOAD_MB * 1024 * 1024, files: 1, fields: 6 },
}).single('image');

export async function saveProofImage(file: Express.Multer.File | undefined): Promise<string> {
  if (!file) throw badRequest('Please attach a screenshot of your payment');
  const ext = detectImage(file.buffer);
  if (!ext) throw badRequest('Only JPEG, PNG or WebP screenshots are allowed');
  const name = `${crypto.randomUUID()}.${ext}`;
  await fs.mkdir(PROOF_ROOT, { recursive: true });
  await fs.writeFile(path.join(PROOF_ROOT, name), file.buffer);
  return name;
}

export const proofImageFile = (name: string) => path.join(PROOF_ROOT, path.basename(name));
export const deleteProofImage = (name: string) => fs.rm(proofImageFile(name), { force: true });
