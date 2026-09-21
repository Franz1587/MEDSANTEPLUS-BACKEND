import { simpleCrudRouter } from '../crud.js';

// Miroir des requêtes authentifiées sur booking_requests (Scheduling.tsx) — la
// création publique (patients anonymes) reste dans routes/public.ts.
export const bookingRequestsRouter = simpleCrudRouter({
  table: 'booking_requests',
  columns: [
    'structure_id', 'ref_number', 'first_name', 'last_name', 'phone', 'whatsapp', 'email',
    'type', 'specialty', 'reason', 'preferred_date', 'preferred_time', 'has_insurance',
    'insurance_id', 'insurance_name', 'insurance_policy_number', 'subscriber_company_id',
    'subscriber_company_name', 'is_cnamgs', 'cnamgs_type', 'nag_cnamgs', 'cnamgs_employer',
    'assigned_doctor_id', 'confirmed_date', 'confirmed_time', 'notify_sms', 'notify_whatsapp',
    'notify_email', 'status', 'patient_portal_account_id',
  ],
  orderBy: 'created_at DESC',
  defaultLimit: 500,
});
