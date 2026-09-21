import { simpleCrudRouter } from '../crud.js';

// Miroir de src/lib/db/emergencies.ts (fetchActiveEmergencies non porté —
// le front peut filtrer côté client sur status in [waiting, in_treatment]).
export const emergenciesRouter = simpleCrudRouter({
  table: 'emergencies',
  columns: ['id', 'structure_id', 'patient_id', 'patient_name', 'assigned_doctor_id', 'arrival_time', 'triage_level', 'chief_complaint', 'status', 'notes', 'created_at', 'updated_at'],
  listSelect: 'id,patient_id,assigned_doctor_id,arrival_time,triage_level,chief_complaint,status',
  orderBy: 'arrival_time DESC',
  defaultLimit: 200,
});
