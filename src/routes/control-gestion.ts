import { Router } from 'express';
import { simpleCrudRouter } from '../crud.js';

/** Miroir de ControlGestion.tsx : charges, immobilisations, lignes
 *  budgétaires. Chaque sous-table garde le pattern CRUD générique déjà
 *  utilisé pour les domaines equipment/hr_*. */
export const controlGestionRouter = Router();

controlGestionRouter.use('/expenses', simpleCrudRouter({
  table: 'expenses',
  columns: [
    'id', 'structure_id', 'date', 'category', 'subcategory', 'description', 'amount',
    'cost_center', 'supplier', 'payment_method', 'payment_ref', 'notes', 'created_by', 'updated_at',
  ],
  orderBy: 'date DESC',
  defaultLimit: 2000,
}));

controlGestionRouter.use('/fixed-assets', simpleCrudRouter({
  table: 'fixed_assets',
  columns: [
    'id', 'structure_id', 'code', 'name', 'category', 'acquisition_date', 'acquisition_value',
    'useful_life_years', 'residual_value', 'supplier', 'serial_number', 'location', 'status',
    'notes', 'created_by',
  ],
  orderBy: 'acquisition_date DESC',
  defaultLimit: 2000,
}));

controlGestionRouter.use('/budget-lines', simpleCrudRouter({
  table: 'budget_lines',
  columns: [
    'id', 'structure_id', 'year', 'month', 'category', 'label', 'budgeted_amount',
    'cost_center', 'notes', 'created_by',
  ],
  orderBy: 'year DESC',
  defaultLimit: 2000,
}));
