import { simpleCrudRouter } from '../crud.js';

// Miroir de src/lib/db/analyse_orders.ts
export const analyseOrdersRouter = simpleCrudRouter({
  table: 'analyse_orders',
  columns: ['id', 'structure_id', 'patient_id', 'consultation_id', 'ordered_by', 'ordered_by_name', 'date', 'urgency', 'status', 'lines', 'clinical_info', 'result_notes', 'admission_notes', 'created_at', 'updated_at'],
  listSelect: 'id,patient_id,date,urgency,status,lines,clinical_info,result_notes,ordered_by,ordered_by_name,admission_notes',
  orderBy: 'date DESC',
  touchUpdatedAt: true,
  relatedColumn: 'patient_id',
});
