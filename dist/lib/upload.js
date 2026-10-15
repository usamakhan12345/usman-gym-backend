"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteProofImage = exports.proofImageFile = exports.proofUpload = exports.PROOF_ROOT = exports.PROFILE_PUBLIC_DIR = exports.profileImageUrl = exports.imageUpload = void 0;
exports.saveProfileImage = saveProfileImage;
exports.deleteProfileImage = deleteProfileImage;
exports.saveProofImage = saveProofImage;
const crypto_1 = __importDefault(require("crypto"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const multer_1 = __importDefault(require("multer"));
const env_1 = require("../config/env");
const errors_1 = require("./errors");
exports.imageUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: env_1.env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 0 },
}).single('image');
/** Detect the real image type from magic bytes — never trust the client's mimetype or filename. */
function detectImage(buf) {
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
        return 'jpg';
    if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
        return 'png';
    if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP')
        return 'webp';
    return null;
}
const PROFILE_DIR = 'profiles';
/** Saves a validated profile image under a random name and returns the stored relative file name. */
async function saveProfileImage(file) {
    if (!file)
        throw (0, errors_1.badRequest)('Please choose an image to upload');
    const ext = detectImage(file.buffer);
    if (!ext)
        throw (0, errors_1.badRequest)('Only JPEG, PNG or WebP images are allowed');
    const name = `${crypto_1.default.randomUUID()}.${ext}`;
    await promises_1.default.mkdir(path_1.default.join(env_1.uploadRoot, PROFILE_DIR), { recursive: true });
    await promises_1.default.writeFile(path_1.default.join(env_1.uploadRoot, PROFILE_DIR, name), file.buffer);
    return name;
}
async function deleteProfileImage(name) {
    if (!name || name !== path_1.default.basename(name))
        return;
    await promises_1.default.rm(path_1.default.join(env_1.uploadRoot, PROFILE_DIR, name), { force: true });
}
const profileImageUrl = (name) => (name ? `/uploads/${PROFILE_DIR}/${name}` : null);
exports.profileImageUrl = profileImageUrl;
exports.PROFILE_PUBLIC_DIR = path_1.default.join(env_1.uploadRoot, PROFILE_DIR);
// ---------------------------------------------------------------- payment proofs (PRIVATE files)
// Never served statically: they are streamed only through authenticated owner/admin routes.
const PROOF_DIR = 'proofs';
exports.PROOF_ROOT = path_1.default.join(env_1.uploadRoot, PROOF_DIR);
exports.proofUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: env_1.env.MAX_PROOF_UPLOAD_MB * 1024 * 1024, files: 1, fields: 6 },
}).single('image');
async function saveProofImage(file) {
    if (!file)
        throw (0, errors_1.badRequest)('Please attach a screenshot of your payment');
    const ext = detectImage(file.buffer);
    if (!ext)
        throw (0, errors_1.badRequest)('Only JPEG, PNG or WebP screenshots are allowed');
    const name = `${crypto_1.default.randomUUID()}.${ext}`;
    await promises_1.default.mkdir(exports.PROOF_ROOT, { recursive: true });
    await promises_1.default.writeFile(path_1.default.join(exports.PROOF_ROOT, name), file.buffer);
    return name;
}
const proofImageFile = (name) => path_1.default.join(exports.PROOF_ROOT, path_1.default.basename(name));
exports.proofImageFile = proofImageFile;
const deleteProofImage = (name) => promises_1.default.rm((0, exports.proofImageFile)(name), { force: true });
exports.deleteProofImage = deleteProofImage;
