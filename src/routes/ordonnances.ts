import { simpleCrudRouter } from '../crud.js';

// Miroir de src/lib/db/ordonnances.ts
export const ordonnancesRouter = simpleCrudRouter({
  table: 'ordonnances',
  columns: ['id', 'structure_id', 'patient_id', 'consultation_id', 'doctor_id', 'date', 'status', 'lines', 'motifs', 'icd_codes', 'notes', 'created_at', 'updated_at'],
  listSelect: 'id,patient_id,consultation_id,date,status,lines,motifs,icd_codes,notes',
  orderBy: 'date DESC',
  touchUpdatedAt: true,
  relatedColumn: 'patient_id',
});
