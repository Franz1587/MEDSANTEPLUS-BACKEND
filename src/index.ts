import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { pool } from './db.js';
import { attachRealtime } from './realtime.js';
import { authRouter } from './routes/auth.js';
import { patientsRouter } from './routes/patients.js';
import { invoicesRouter } from './routes/invoices.js';
import { stockRouter } from './routes/stock.js';
import { ordonnancesRouter } from './routes/ordonnances.js';
import { paymentsRouter } from './routes/payments.js';
import { analyseOrdersRouter } from './routes/analyse_orders.js';
import { consultationsRouter } from './routes/consultations.js';
import { appointmentsRouter } from './routes/appointments.js';
import { emergenciesRouter } from './routes/emergencies.js';
import { hospitalizationsRouter } from './routes/hospitalizations.js';
import { imagingRouter } from './routes/imaging.js';
import { labRouter } from './routes/lab.js';
import { vitalsRouter } from './routes/vitals.js';
import { roomsRouter } from './routes/rooms.js';
import { insuranceRouter } from './routes/insurance.js';
import { structuresRouter } from './routes/structures.js';
import { profilesRouter } from './routes/profiles.js';
import { staffRouter } from './routes/staff.js';
import { insuranceStatementsRouter } from './routes/insurance-statements.js';
import { patientInsurancesRouter } from './routes/patient-insurances.js';
import { devisRouter } from './routes/devis.js';
import { queueRouter } from './routes/queue.js';
import { hospActsRouter } from './routes/hosp-acts.js';
import { medicalDocumentsRouter } from './routes/medical-documents.js';
import { actTypesRouter } from './routes/act-types.js';
import { sagefemmeRouter } from './routes/sagefemme.js';
import { teleconsultRouter } from './routes/teleconsult.js';
import { edgeFunctionsRouter } from './routes/edge-functions.js';
import { partnerApiRouter } from './routes/partner-api.js';
import { notificationsRouter } from './routes/notifications.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT 1 AS ok');
    res.json({ status: 'ok', db: rows[0]?.ok === 1 });
  } catch (err) {
    console.error('[health] échec requête DB:', err);
    res.status(500).json({ status: 'error', message: (err as Error).message });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/patients', patientsRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/stock-items', stockRouter);
app.use('/api/ordonnances', ordonnancesRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/analyse-orders', analyseOrdersRouter);
app.use('/api/consultations', consultationsRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/emergencies', emergenciesRouter);
app.use('/api/hospitalizations', hospitalizationsRouter);
app.use('/api/imaging-tests', imagingRouter);
app.use('/api/lab-tests', labRouter);
app.use('/api/vital-records', vitalsRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/insurance', insuranceRouter);
app.use('/api/structures', structuresRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/staff', staffRouter);
app.use('/api/insurance-statements', insuranceStatementsRouter);
app.use('/api/patient-insurances', patientInsurancesRouter);
app.use('/api/devis', devisRouter);
app.use('/api/queue', queueRouter);
app.use('/api/hospitalization-acts', hospActsRouter);
app.use('/api/medical-documents', medicalDocumentsRouter);
app.use('/api/act-types', actTypesRouter);
app.use('/api/sagefemme', sagefemmeRouter);
app.use('/api/teleconsult', teleconsultRouter);
app.use('/api', edgeFunctionsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/partner-api', partnerApiRouter);

// Middleware d'erreurs global — toute route enveloppée par asyncHandler()
// atterrit ici plutôt que de faire planter le process.
app.use((err: Error & { status?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  // err.code = code SQLSTATE Postgres (ex: 23505 = violation unicité) quand
  // l'erreur vient de `pg` — transmis tel quel pour que le front puisse
  // continuer à faire des `if (err.code === '23505')` comme avec PostgREST.
  res.status(err.status ?? 500).json({ error: err.message ?? 'Erreur interne', code: err.code });
});

const port = process.env.PORT ? Number(process.env.PORT) : 3003;
const server = http.createServer(app);
attachRealtime(server);
server.listen(port, () => {
  console.log(`medsanteplus-backend listening on :${port}`);
});
