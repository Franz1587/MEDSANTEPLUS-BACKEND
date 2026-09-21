import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../util.js';

/** Stockage fichiers local (bind-mount Docker `/app/uploads` → hôte
 *  `/opt/medsanteplus/backend-uploads`) — remplace Supabase Storage pour les
 *  2 derniers usages restants (documents patients, logos assureurs). Fichiers
 *  servis publiquement sous /api/uploads/files/*, comme le faisait déjà
 *  getPublicUrl() côté Supabase (chemin non-devinable, pas de listing). */
export const uploadsRouter = Router();

const UPLOAD_ROOT = path.resolve('/app/uploads');

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const category = String((req.body as Record<string, unknown>).category ?? 'misc').replace(/[^a-zA-Z0-9/_-]/g, '');
    const dir = path.join(UPLOAD_ROOT, category);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, safeName);
  },
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

uploadsRouter.post('/', requireAuth, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'Aucun fichier reçu' }); return; }
  const category = String((req.body as Record<string, unknown>).category ?? 'misc').replace(/[^a-zA-Z0-9/_-]/g, '');
  const relPath = `${category}/${req.file.filename}`;
  res.status(201).json({ path: relPath, url: `/api/uploads/files/${relPath}` });
}));

uploadsRouter.delete('/', requireAuth, asyncHandler(async (req, res) => {
  const { path: relPath } = req.query as { path?: string };
  if (!relPath) { res.status(400).json({ error: 'path requis' }); return; }
  const resolved = path.resolve(UPLOAD_ROOT, relPath);
  if (!resolved.startsWith(UPLOAD_ROOT)) { res.status(400).json({ error: 'Chemin invalide' }); return; }
  fs.rm(resolved, { force: true }, () => res.status(204).end());
}));
