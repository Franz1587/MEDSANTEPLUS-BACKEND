import { simpleCrudRouter } from '../crud.js';

// Miroir de src/lib/db/appointments.ts (filtre par date exacte non porté —
// le front peut filtrer côté client sur la liste complète de la structure).
export const appointmentsRouter = simpleCrudRouter({
  table: 'appointments',
  columns: ['id', 'structure_id', 'patient_id', 'doctor_id', 'date', 'time', 'duration', 'type', 'status', 'notes', 'created_at'],
  listSelect: 'id,patient_id,doctor_id,date,time,type,status,notes',
  orderBy: 'date, time',
  defaultLimit: 500,
  relatedColumn: 'patient_id',
});
