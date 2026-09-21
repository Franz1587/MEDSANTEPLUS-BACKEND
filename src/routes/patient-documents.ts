import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildInsert, buildUpdate } from '../util.js';

/** Miroir de src/lib/db/patient-documents.ts — le fichier lui-même est
 *  maintenant géré par routes/uploads.ts (stockage local), cette table ne
 *  garde que les métadonnées. */
export const patientDocumentsRouter = Router();
patientDocumentsRouter.use(requireAuth);

const DOC_COLUMNS = [
  'patient_id', 'structure_id', 'tab_context', 'display_name', 'original_name',
  'file_url', 'file_path', 'file_type', 'file_size', 'uploaded_by', 'uploaded_by_name',
  'ocr_text', 'ocr_fields', 'ocr_status', 'is_antedated', 'document_date', 'notes',
] as const;

function normalizeJson(body: Record<string, unknown>) {
  if (body.ocr_fields !== undefined && body.ocr_fields !== null && typeof body.ocr_fields !== 'string') {
    return { ...body, ocr_fields: JSON.stringify(body.ocr_fields) };
  }
  return body;
}

// GET /api/patient-documents?patientId=&structureId=&tabContext=
patientDocumentsRouter.get('/', asyncHandler(async (req, res) => {
  const { patientId, structureId, tabContext } = req.query as { patientId?: string; structureId?: string; tabContext?: string };
  if (!patientId || !structureId) { res.status(400).json({ error: 'patientId et structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) => {
    const values: unknown[] = [patientId, structureId];
    let where = 'patient_id = $1 AND structure_id = $2';
    if (tabContext) { values.push(tabContext); where += ` AND tab_context = $${values.length}`; }
    return client.query(`SELECT * FROM patient_documents WHERE ${where} ORDER BY created_at DESC`, values)
      .then((r) => r.rows);
  });
  res.json(rows);
}));

patientDocumentsRouter.post('/', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('patient_documents', DOC_COLUMNS, normalizeJson(req.body));
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));

patientDocumentsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const update = buildUpdate('patient_documents', DOC_COLUMNS, normalizeJson(req.body), 'id', req.params.id);
    if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
    const { rows } = await client.query(update.text, update.values);
    return rows[0];
  });
  res.json(row);
}));

patientDocumentsRouter.delete('/:id', asyncHandler(async (req, res) => {
  await withUserContext(req.authUser!, (client) =>
    client.query('DELETE FROM patient_documents WHERE id = $1', [req.params.id]),
  );
  res.status(204).end();
}));
