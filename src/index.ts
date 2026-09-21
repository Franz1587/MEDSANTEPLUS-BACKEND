import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pool } from './db.js';
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

// Middleware d'erreurs global — toute route enveloppée par asyncHandler()
// atterrit ici plutôt que de faire planter le process.
app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  res.status(err.status ?? 500).json({ error: err.message ?? 'Erreur interne' });
});

const port = process.env.PORT ? Number(process.env.PORT) : 3003;
app.listen(port, () => {
  console.log(`medsanteplus-backend listening on :${port}`);
});
