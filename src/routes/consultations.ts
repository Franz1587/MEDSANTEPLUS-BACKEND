import { simpleCrudRouter } from '../crud.js';

// Miroir de src/lib/db/consultations.ts (fetchConsultationsByDoctor non porté —
// filtre spécifique à couvrir plus tard si besoin, voir suivi migration).
export const consultationsRouter = simpleCrudRouter({
  table: 'consultations',
  columns: ['id', 'structure_id', 'patient_id', 'doctor_id', 'date', 'time', 'type', 'status', 'chief_complaint', 'diagnosis', 'notes', 'vital_signs', 'prescriptions', 'treatment', 'icd_codes', 'lab_test_ids', 'imaging_test_ids', 'created_at', 'updated_at'],
  listSelect: 'id,patient_id,doctor_id,date,type,status,chief_complaint,diagnosis,icd_codes,notes,vital_signs,prescriptions',
  orderBy: 'date DESC',
  relatedColumn: 'patient_id',
});
