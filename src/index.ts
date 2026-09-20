import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pool } from './db.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT 1 AS ok');
    res.json({ status: 'ok', db: rows[0]?.ok === 1 });
  } catch (err) {
    res.status(500).json({ status: 'error', message: (err as Error).message });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3003;
app.listen(port, () => {
  console.log(`medsanteplus-backend listening on :${port}`);
});
