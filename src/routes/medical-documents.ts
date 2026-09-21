import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../util.js';

export const medicalDocumentsRouter = Router();
medicalDocumentsRouter.use(requireAuth);

const DOC_COLUMNS = [
  'structure_id', 'patient_id', 'patient_name', 'type', 'content', 'doctor_id', 'doctor_name',
  'doctor_specialty', 'doctor_num_ordre', 'created_by_id', 'created_by_name', 'created_by_role',
] as const;

function normalizeContent(body: Record<string, unknown>): Record<string, unknown> {
  return body.content !== undefined && typeof body.content !== 'string'
    ? { ...body, content: JSON.stringify(body.content) }
    : body;
}

medicalDocumentsRouter.get('/by-patient/:patientId', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM medical_documents WHERE patient_id = $1 ORDER BY created_at DESC', [req.params.patientId])
      .then((r) => r.rows),
  );
  res.json(rows);
}));

medicalDocumentsRouter.get('/', asyncHandler(async (req, res) => {
  const { structureId, limit } = req.query as { structureId?: string; limit?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM medical_documents WHERE structure_id = $1 ORDER BY created_at DESC LIMIT $2', [structureId, Number(limit) || 200])
      .then((r) => r.rows),
  );
  res.json(rows);
}));

medicalDocumentsRouter.post('/', asyncHandler(async (req, res) => {
  const body = normalizeContent(req.body);
  const cols = DOC_COLUMNS.filter((c) => body[c] !== undefined);
  const values = cols.map((c) => body[c]);
  const row = await withUserContext(req.authUser!, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO medical_documents (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
      values,
    );
    return rows[0];
  });
  res.status(201).json(row);
}));

// Miroir de updateMedicalDocument() : champs de traçabilité de création jamais acceptés en update.
const DOC_UPDATABLE = DOC_COLUMNS.filter((c) => !['structure_id', 'patient_id', 'created_by_id', 'created_by_name', 'created_by_role'].includes(c));
medicalDocumentsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const body: Record<string, unknown> = { ...normalizeContent(req.body), updated_at: new Date().toISOString() };
  const cols = [...DOC_UPDATABLE, 'updated_by_id', 'updated_by_name', 'updated_at'].filter((c) => body[c] !== undefined);
  if (cols.length === 0) { res.status(400).json({ error: 'Aucun champ à mettre à jour' }); return; }
  const values = cols.map((c) => body[c]);
  values.push(req.params.id);
  const row = await withUserContext(req.authUser!, async (client) => {
    const sets = cols.map((c, i) => `${c} = $${i + 1}`);
    const { rows } = await client.query(`UPDATE medical_documents SET ${sets.join(',')} WHERE id = $${values.length} RETURNING *`, values);
    return rows[0];
  });
  res.json(row);
}));

medicalDocumentsRouter.delete('/:id', asyncHandler(async (req, res) => {
  await withUserContext(req.authUser!, (client) => client.query('DELETE FROM medical_documents WHERE id = $1', [req.params.id]));
  res.status(204).end();
}));
