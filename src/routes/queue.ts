import { Router } from 'express';
import type { PoolClient } from 'pg';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../util.js';

export const queueRouter = Router();
queueRouter.use(requireAuth);

// Miroir de src/lib/db/queue.ts. La synchronisation temps réel
// (subscribeToQueueTickets/subscribeToQueue) n'est pas encore portée — elle
// suivra avec le relais WebSocket prévu pour l'ensemble de l'app (voir plan
// de migration, section "Temps réel").

const SERVICE_PREFIXES: Record<string, string> = {
  medecine_generale: 'MG', medecine_interne: 'MI', cardiologie: 'CARD', pediatrie: 'PED',
  gynecologie: 'GYN', gynecologie_obstetrique: 'GYO', chirurgie: 'CHR', chirurgie_digestive: 'CHD',
  orthopedie: 'ORT', orl: 'ORL', dermatologie: 'DERM', ophtalmologie: 'OPH', neurologie: 'NEU',
  pneumologie: 'PNE', psychiatrie: 'PSY', gastro_enterologie: 'GAS', nephrologie: 'NEP',
  rhumatologie: 'RHU', stomatologie: 'STM', urgences: 'URG', nutrition: 'NUT', accueil: 'ACC',
  laboratoire: 'LAB', imagerie: 'IMG', dentaire: 'DENT',
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function sortTickets<T extends { priority: string; bookedTime?: string | null; rank: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
    if (b.priority === 'urgent' && a.priority !== 'urgent') return 1;
    if (a.bookedTime && b.bookedTime) return a.bookedTime.localeCompare(b.bookedTime);
    if (a.bookedTime && !b.bookedTime) return -1;
    if (!a.bookedTime && b.bookedTime) return 1;
    return a.rank - b.rank;
  });
}

async function fetchTodayAndPastActive(client: PoolClient, structureId: string) {
  const today = todayStr();
  const [todayRes, pastRes] = await Promise.all([
    client.query('SELECT * FROM queue_tickets WHERE structure_id = $1 AND date = $2 ORDER BY rank ASC', [structureId, today]),
    client.query(
      "SELECT * FROM queue_tickets WHERE structure_id = $1 AND date < $2 AND status IN ('waiting','calling','in_progress') ORDER BY rank ASC",
      [structureId, today],
    ),
  ]);
  const seen = new Set<string>();
  const merged: Record<string, unknown>[] = [];
  for (const r of [...todayRes.rows, ...pastRes.rows]) {
    if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
  }
  return merged;
}

// GET /api/queue/today?structureId=... — miroir de fetchTodayTickets()
// (normalizeHistoricalRows — réaffectation de service selon la spécialité du
// médecin — n'est pas reportée ici : cas de bord mineur, à ajouter si besoin réel).
queueRouter.get('/today', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) => fetchTodayAndPastActive(client, structureId));
  res.json(rows);
}));

// GET /api/queue/by-service?structureId=&serviceId= — miroir de fetchTicketsByService()
queueRouter.get('/by-service', asyncHandler(async (req, res) => {
  const { structureId, serviceId } = req.query as { structureId?: string; serviceId?: string };
  if (!structureId || !serviceId) { res.status(400).json({ error: 'structureId et serviceId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) => fetchTodayAndPastActive(client, structureId));
  const filtered = rows.filter((r) => r.service_id === serviceId) as unknown as Array<{ priority: string; booked_time: string | null; rank: number }>;
  res.json(sortTickets(filtered.map((r) => ({ ...r, bookedTime: r.booked_time }))));
}));

// GET /api/queue/by-doctor?structureId=&doctorStaffId= — miroir de fetchTicketsByDoctor()
queueRouter.get('/by-doctor', asyncHandler(async (req, res) => {
  const { structureId, doctorStaffId } = req.query as { structureId?: string; doctorStaffId?: string };
  if (!structureId || !doctorStaffId) { res.status(400).json({ error: 'structureId et doctorStaffId requis' }); return; }
  const rows = await withUserContext(req.authUser!, async (client) => {
    const today = todayStr();
    const [assigned, unassigned, pastAssigned] = await Promise.all([
      client.query('SELECT * FROM queue_tickets WHERE structure_id = $1 AND doctor_staff_id = $2 AND date = $3 ORDER BY rank', [structureId, doctorStaffId, today]),
      client.query('SELECT * FROM queue_tickets WHERE structure_id = $1 AND doctor_staff_id IS NULL AND date = $2 ORDER BY rank', [structureId, today]),
      client.query(
        "SELECT * FROM queue_tickets WHERE structure_id = $1 AND doctor_staff_id = $2 AND date < $3 AND status IN ('waiting','calling','in_progress') ORDER BY rank",
        [structureId, doctorStaffId, today],
      ),
    ]);
    const seen = new Set<string>();
    const merged: Record<string, unknown>[] = [];
    for (const r of [...assigned.rows, ...unassigned.rows, ...pastAssigned.rows]) {
      if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
    }
    return merged;
  });
  res.json(sortTickets(rows.map((r: any) => ({ ...r, bookedTime: r.booked_time }))));
}));

// POST /api/queue/tickets — miroir de issueTicketDB() (rang atomique avec retry)
queueRouter.post('/tickets', asyncHandler(async (req, res) => {
  const p = req.body as {
    structureId: string; serviceId: string; serviceLabel: string; patientName: string;
    priority?: string; patientId?: string; bookingRequestId?: string; bookedTime?: string;
    doctorStaffId?: string; doctorName?: string; notes?: string;
  };
  const prefix = SERVICE_PREFIXES[p.serviceId] ?? p.serviceId.slice(0, 3).toUpperCase();
  const d = todayStr();

  const ticket = await withUserContext(req.authUser!, async (client) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { rows: maxRows } = await client.query(
        'SELECT rank FROM queue_tickets WHERE structure_id = $1 AND service_id = $2 AND date = $3 ORDER BY rank DESC LIMIT 1',
        [p.structureId, p.serviceId, d],
      );
      const rank = (maxRows[0]?.rank ?? 0) + 1;
      const ticketNumber = `${prefix}-${String(rank).padStart(3, '0')}`;
      const id = `TKT-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      try {
        const { rows } = await client.query(
          `INSERT INTO queue_tickets
            (id, structure_id, ticket_number, service_id, service_label, patient_name, patient_id,
             priority, status, rank, date, issued_at, booked_time, doctor_staff_id, doctor_name, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'waiting',$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [id, p.structureId, ticketNumber, p.serviceId, p.serviceLabel, p.patientName, p.patientId ?? null,
           p.priority ?? 'normal', rank, d, new Date().toISOString(), p.bookedTime ?? null,
           p.doctorStaffId ?? null, p.doctorName ?? null, p.notes ?? null],
        );
        return rows[0];
      } catch (err) {
        if ((err as { code?: string }).code !== '23505') throw err;
        await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
      }
    }
    throw new Error('Impossible de créer un ticket (collision rang, 5 tentatives échouées)');
  });
  res.status(201).json(ticket);
}));

// PATCH /api/queue/tickets/:id/status — miroir de updateTicketStatusDB()
queueRouter.patch('/tickets/:id/status', asyncHandler(async (req, res) => {
  const u = req.body as {
    status: string; calledAt?: string; startedAt?: string; doneAt?: string;
    counterLabel?: string; doctorName?: string;
  };
  const cols: string[] = ['status'];
  const values: unknown[] = [u.status];
  if (u.calledAt !== undefined) { cols.push('called_at'); values.push(u.calledAt); }
  if (u.startedAt !== undefined) { cols.push('started_at'); values.push(u.startedAt); }
  if (u.doneAt !== undefined) { cols.push('done_at'); values.push(u.doneAt); }
  if (u.counterLabel !== undefined) { cols.push('counter_label'); values.push(u.counterLabel); }
  if (u.doctorName !== undefined) { cols.push('doctor_name'); values.push(u.doctorName); }
  values.push(req.params.id);
  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  await withUserContext(req.authUser!, (client) =>
    client.query(`UPDATE queue_tickets SET ${sets.join(',')} WHERE id = $${values.length}`, values),
  );
  res.status(204).end();
}));

// POST /api/queue/call-next — miroir de callNextTicketDB()
queueRouter.post('/call-next', asyncHandler(async (req, res) => {
  const { structureId, serviceId, counterLabel, doctorName } = req.body as {
    structureId: string; serviceId: string; counterLabel: string; doctorName?: string;
  };
  const ticket = await withUserContext(req.authUser!, async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM queue_tickets WHERE structure_id = $1 AND date = $2 AND status = 'waiting'",
      [structureId, todayStr()],
    );
    const filtered = rows.filter((r) => r.service_id === serviceId) as Array<Record<string, unknown> & { priority: string; booked_time: string | null; rank: number }>;
    if (filtered.length === 0) return null;
    const sorted: any[] = sortTickets(filtered.map((r) => ({ ...r, bookedTime: r.booked_time as string | null })));
    const next = sorted[0] as Record<string, unknown> & { id: string };
    const now = new Date().toISOString();
    const sets = ['status = $1', 'called_at = $2', 'counter_label = $3'];
    const values: unknown[] = ['calling', now, counterLabel];
    if (doctorName) { sets.push(`doctor_name = $${values.length + 1}`); values.push(doctorName); }
    values.push(next.id);
    const { rows: updated } = await client.query(
      `UPDATE queue_tickets SET ${sets.join(',')} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    return updated[0];
  });
  res.json(ticket);
}));

// POST /api/queue/auto-close-orphaned — miroir de autoCloseOrphanedTickets()
queueRouter.post('/auto-close-orphaned', asyncHandler(async (req, res) => {
  const { structureId } = req.body as { structureId: string };
  await withUserContext(req.authUser!, async (client) => {
    const today = todayStr();
    const now = new Date().toISOString();

    // 1. Tickets actifs de jours précédents → clôture immédiate
    await client.query(
      "UPDATE queue_tickets SET status = 'done', done_at = $1 WHERE structure_id = $2 AND date < $3 AND status IN ('in_progress','calling','waiting')",
      [now, structureId, today],
    );

    // 2. Tickets actifs du jour dont la consultation est déjà terminée
    const { rows: active } = await client.query(
      "SELECT id, patient_id FROM queue_tickets WHERE structure_id = $1 AND date = $2 AND status IN ('in_progress','calling')",
      [structureId, today],
    );
    const patientIds = [...new Set(active.map((r) => r.patient_id).filter(Boolean))];
    if (patientIds.length === 0) return;

    const { rows: completed } = await client.query(
      "SELECT patient_id FROM consultations WHERE structure_id = $1 AND date = $2 AND status = 'completed' AND patient_id = ANY($3)",
      [structureId, today, patientIds],
    );
    const donePatientIds = new Set(completed.map((r) => r.patient_id));
    const toClose = active.filter((r) => r.patient_id && donePatientIds.has(r.patient_id)).map((r) => r.id);
    if (toClose.length > 0) {
      await client.query("UPDATE queue_tickets SET status = 'done', done_at = $1 WHERE id = ANY($2)", [now, toClose]);
    }
  });
  res.status(204).end();
}));
