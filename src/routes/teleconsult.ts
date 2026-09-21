import { Router } from 'express';
import crypto from 'node:crypto';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildInsert } from '../util.js';

export const teleconsultRouter = Router();
teleconsultRouter.use(requireAuth);

// Miroir de src/lib/db/teleconsult.ts (subscribeToTeleconsultSessions —
// temps réel — suit la phase WebSocket, pas encore portée).
const SESSION_COLUMNS = [
  'structure_id', 'room_id', 'doctor_id', 'doctor_name', 'doctor_specialty',
  'patient_name', 'patient_email', 'patient_id', 'booking_ref', 'status',
] as const;

teleconsultRouter.post('/sessions', asyncHandler(async (req, res) => {
  const p = req.body as {
    structureId: string; doctorId?: string; doctorName: string; doctorSpecialty?: string;
    patientName: string; patientEmail?: string; patientId?: string; bookingRef?: string;
  };
  const roomId = `medsante-${crypto.randomUUID()}`;
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('teleconsult_sessions', SESSION_COLUMNS, {
      structure_id: p.structureId, room_id: roomId, doctor_id: p.doctorId ?? null,
      doctor_name: p.doctorName, doctor_specialty: p.doctorSpecialty ?? null,
      patient_name: p.patientName, patient_email: p.patientEmail ?? null,
      patient_id: p.patientId ?? null, booking_ref: p.bookingRef ?? null, status: 'waiting',
    });
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));

teleconsultRouter.get('/sessions/active', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query(
      "SELECT * FROM teleconsult_sessions WHERE structure_id = $1 AND status IN ('waiting','active') ORDER BY created_at DESC",
      [structureId],
    ).then((r) => r.rows),
  );
  res.json(rows);
}));

teleconsultRouter.get('/sessions/by-patient-email', asyncHandler(async (req, res) => {
  const { patientEmail, structureId } = req.query as { patientEmail?: string; structureId?: string };
  if (!patientEmail || !structureId) { res.status(400).json({ error: 'patientEmail et structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query(
      "SELECT * FROM teleconsult_sessions WHERE patient_email = $1 AND structure_id = $2 AND status IN ('waiting','active') ORDER BY created_at DESC",
      [patientEmail, structureId],
    ).then((r) => r.rows),
  );
  res.json(rows);
}));

teleconsultRouter.patch('/sessions/:id/status', asyncHandler(async (req, res) => {
  const { status } = req.body as { status: 'waiting' | 'active' | 'ended' };
  const sets = ['status = $1'];
  const values: unknown[] = [status];
  if (status === 'active') { sets.push(`started_at = $${values.length + 1}`); values.push(new Date().toISOString()); }
  if (status === 'ended') { sets.push(`ended_at = $${values.length + 1}`); values.push(new Date().toISOString()); }
  values.push(req.params.id);
  await withUserContext(req.authUser!, (client) =>
    client.query(`UPDATE teleconsult_sessions SET ${sets.join(',')} WHERE id = $${values.length}`, values),
  );
  res.status(204).end();
}));

teleconsultRouter.patch('/sessions/:id/notes', asyncHandler(async (req, res) => {
  const notes = { ...req.body, savedAt: new Date().toISOString() };
  await withUserContext(req.authUser!, (client) =>
    client.query('UPDATE teleconsult_sessions SET consultation_notes = $1 WHERE id = $2', [JSON.stringify(notes), req.params.id]),
  );
  res.status(204).end();
}));
