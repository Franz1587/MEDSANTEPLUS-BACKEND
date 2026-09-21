import { simpleCrudRouter } from '../crud.js';

// Miroir de src/lib/db/payments.ts
export const paymentsRouter = simpleCrudRouter({
  table: 'payments',
  columns: ['id', 'structure_id', 'invoice_id', 'patient_id', 'date', 'amount', 'method', 'reference', 'received_by', 'notes', 'created_at'],
  orderBy: 'created_at DESC',
  defaultLimit: 500,
  relatedColumn: 'invoice_id',
});
