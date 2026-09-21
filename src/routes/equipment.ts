import { simpleCrudRouter } from '../crud.js';

// Miroir de Logistics.tsx
export const equipmentRouter = simpleCrudRouter({
  table: 'equipment',
  columns: [
    'id', 'structure_id', 'room_id', 'name', 'code', 'category', 'department', 'status',
    'serial_number', 'purchase_date', 'warranty_until', 'last_maintenance_date',
    'next_maintenance_date', 'purchase_price', 'supplier', 'notes',
  ],
  orderBy: 'created_at',
  defaultLimit: 1000,
});
