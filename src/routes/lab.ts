import { simpleCrudRouter } from '../crud.js';

// Miroir de src/lib/db/lab.ts
export const labRouter = simpleCrudRouter({
  table: 'lab_tests',
  columns: ['id', 'structure_id', 'patient_id', 'doctor_id', 'date', 'test_type', 'status', 'results', 'notes', 'urgent', 'consultation_id', 'ordered_by_name', 'created_at', 'updated_at'],
  listSelect: 'id,patient_id,doctor_id,date,test_type,status,results,notes,urgent',
  orderBy: 'date DESC',
  relatedColumn: 'patient_id',
});
