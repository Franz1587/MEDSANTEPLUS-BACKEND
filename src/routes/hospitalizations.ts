import { simpleCrudRouter } from '../crud.js';

// Miroir de src/lib/db/hospitalizations.ts (fetchActiveHospitalizations non
// porté — le front peut filtrer côté client sur status = 'active').
export const hospitalizationsRouter = simpleCrudRouter({
  table: 'hospitalizations',
  columns: ['id', 'structure_id', 'patient_id', 'attending_doctor_id', 'admission_date', 'discharge_date', 'room', 'bed', 'ward', 'diagnosis', 'status', 'discharge_summary', 'expected_exit_date', 'created_at', 'updated_at'],
  listSelect: 'id,patient_id,attending_doctor_id,admission_date,discharge_date,room,bed,diagnosis,status,expected_exit_date',
  orderBy: 'admission_date DESC',
  defaultLimit: 200,
  relatedColumn: 'patient_id',
});
