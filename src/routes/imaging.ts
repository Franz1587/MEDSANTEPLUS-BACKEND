import { simpleCrudRouter } from '../crud.js';

// Miroir de src/lib/db/imaging.ts
export const imagingRouter = simpleCrudRouter({
  table: 'imaging_tests',
  columns: ['id', 'structure_id', 'patient_id', 'doctor_id', 'date', 'modality', 'body_part', 'status', 'findings', 'conclusion', 'image_urls', 'urgent', 'consultation_id', 'requested_by', 'created_at', 'updated_at'],
  listSelect: 'id,patient_id,doctor_id,date,modality,status,findings,image_urls',
  orderBy: 'date DESC',
  relatedColumn: 'patient_id',
});
