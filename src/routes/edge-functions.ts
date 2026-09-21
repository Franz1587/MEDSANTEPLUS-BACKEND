import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { adminPool, withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildUpdate } from '../util.js';
import { createAuthUser, updateAuthUserPassword, updateAuthUserEmail, banUser, unbanUser, deleteAuthUser } from '../admin-auth.js';

/**
 * Portage des 6 Edge Functions Supabase (Deno) en routes Express. Miroir
 * fonctionnel 1:1 — voir supabase/functions/ (index.ts de chaque dossier)
 * dans le frontend pour la logique d'origine. supabase.functions.invoke(name,
 * {body}) devient fetch('/api/'+name, {method:'POST', body}) côté client
 * (voir plan de migration lively-riding-quilt.md).
 */

export const edgeFunctionsRouter = Router();

// ─── create-staff-user ──────────────────────────────────────────────────────

edgeFunctionsRouter.post(
  '/create-staff-user',
  requireAuth,
  asyncHandler(async (req, res) => {
    const callerId = req.authUser!.id;
    const callerProfile = await withUserContext({ id: callerId }, async (client) => {
      const { rows } = await client.query(
        'SELECT role, structure_id, structure_type FROM profiles WHERE id = $1 LIMIT 1',
        [callerId],
      );
      return rows[0] ?? null;
    });
    if (!callerProfile) {
      res.status(401).json({ error: 'Profil de l’appelant introuvable' });
      return;
    }

    const ALLOWED_ROLES = ['super_admin', 'support_admin', 'admin'];
    if (!ALLOWED_ROLES.includes(callerProfile.role)) {
      res.status(403).json({ error: 'Rôle insuffisant' });
      return;
    }

    const {
      email, password, first_name, last_name,
      role, role_label, description, specialization,
      structure_id, structure_type,
    } = req.body as Record<string, unknown>;

    if (!email || !password || !first_name || !last_name || !role) {
      res.status(400).json({ error: 'Champs requis manquants : email, password, first_name, last_name, role' });
      return;
    }
    if (String(password).length < 8) {
      res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
      return;
    }

    const effectiveStructureId = callerProfile.role === 'admin' ? callerProfile.structure_id : ((structure_id as string) ?? null);
    const effectiveStructureType = callerProfile.role === 'admin' ? callerProfile.structure_type : ((structure_type as string) ?? null);

    const cleanEmail = String(email).toLowerCase().trim();
    const newUserId = await createAuthUser(cleanEmail, String(password));

    let staffId: string | null = null;
    if (effectiveStructureId) {
      const candidateId = randomUUID();
      try {
        await adminPool.query(
          `INSERT INTO staff (id, structure_id, first_name, last_name, role, email, specialization, status, hire_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'active',CURRENT_DATE)`,
          [
            candidateId, effectiveStructureId, String(first_name).trim(), String(last_name).trim(),
            role, cleanEmail, specialization ? String(specialization).trim() : null,
          ],
        );
        staffId = candidateId;
      } catch (e) {
        console.warn('[create-staff-user] staff insert failed:', (e as Error).message);
      }
    }

    try {
      await adminPool.query(
        `INSERT INTO profiles (id, username, full_name, role, role_label, description, structure_id, structure_type, staff_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          newUserId, cleanEmail, `${String(first_name).trim()} ${String(last_name).trim()}`,
          role, role_label ?? role, description ?? '', effectiveStructureId, effectiveStructureType, staffId,
        ],
      );
    } catch (e) {
      if (staffId) await adminPool.query('DELETE FROM staff WHERE id = $1', [staffId]);
      await deleteAuthUser(newUserId);
      res.status(400).json({ error: `Échec de la création du profil : ${(e as Error).message}` });
      return;
    }

    res.json({ id: newUserId, staffId, username: cleanEmail });
  }),
);

// ─── manage-user ────────────────────────────────────────────────────────────

const PLATFORM_ADMIN_EMAILS = ['loscarfranz@gmail.com', 'superadmin@medsante.ga', 'support1@medsante.ga'];

edgeFunctionsRouter.post(
  '/manage-user',
  requireAuth,
  asyncHandler(async (req, res) => {
    const callerId = req.authUser!.id;

    const { rows: callerRows } = await adminPool.query(
      'SELECT role, structure_id FROM profiles WHERE id = $1 LIMIT 1',
      [callerId],
    );
    const callerProfile = callerRows[0] as { role?: string; structure_id?: string | null } | undefined;
    const { rows: callerAuthRows } = await adminPool.query('SELECT email FROM auth.users WHERE id = $1 LIMIT 1', [callerId]);
    const callerEmail = callerAuthRows[0]?.email ?? '';
    const callerRole = String(callerProfile?.role ?? '');
    const isPlatformAdmin = ['super_admin', 'support_admin'].includes(callerRole) || PLATFORM_ADMIN_EMAILS.includes(callerEmail);
    const isClinicAdmin = callerRole === 'admin';

    if (!isPlatformAdmin && !isClinicAdmin) {
      res.status(403).json({ error: `Accès non autorisé (role: ${callerRole}, email: ${callerEmail})` });
      return;
    }

    const {
      action, userId, fullName, role, roleLabel, structureId, structureType,
      newPassword, newEmail, specialization,
    } = req.body as Record<string, unknown>;

    if (!action || !userId) {
      res.status(400).json({ error: 'action et userId sont requis' });
      return;
    }

    // Résoudre l'UUID auth depuis userId (staff.id ≠ auth UUID)
    let authUserId: string | null = null;
    const { rows: profByIdRows } = await adminPool.query('SELECT id FROM profiles WHERE id = $1 LIMIT 1', [userId]);
    if (profByIdRows[0]?.id) {
      authUserId = profByIdRows[0].id;
    } else {
      const { rows: staffRows } = await adminPool.query('SELECT email FROM staff WHERE id = $1 LIMIT 1', [userId]);
      const staffEmail = staffRows[0]?.email ?? '';
      if (staffEmail) {
        const { rows: profByEmailRows } = await adminPool.query('SELECT id FROM profiles WHERE username = $1 LIMIT 1', [staffEmail]);
        authUserId = profByEmailRows[0]?.id ?? null;
      }
    }

    if (isClinicAdmin) {
      let targetStructureId: string | null = null;
      if (authUserId) {
        const { rows } = await adminPool.query('SELECT structure_id FROM profiles WHERE id = $1 LIMIT 1', [authUserId]);
        targetStructureId = rows[0]?.structure_id ?? null;
      } else {
        const { rows } = await adminPool.query('SELECT structure_id FROM staff WHERE id = $1 LIMIT 1', [userId]);
        targetStructureId = rows[0]?.structure_id ?? null;
      }
      if (targetStructureId !== (callerProfile?.structure_id ?? null)) {
        res.status(403).json({ error: 'Vous ne pouvez gérer que les utilisateurs de votre clinique' });
        return;
      }
      if (role && ['super_admin', 'support_admin', 'admin'].includes(String(role))) {
        res.status(403).json({ error: 'Vous ne pouvez pas attribuer ce rôle' });
        return;
      }
      if (structureId !== undefined && structureId !== (callerProfile?.structure_id ?? null)) {
        res.status(403).json({ error: "Vous ne pouvez pas changer la structure d'un utilisateur" });
        return;
      }
    }

    if (action === 'update') {
      const profileUpdates: Record<string, unknown> = {};
      const staffUpdates: Record<string, unknown> = {};

      if (fullName !== undefined) {
        profileUpdates.full_name = fullName;
        const parts = String(fullName).trim().split(/\s+/);
        staffUpdates.first_name = parts[0] ?? '';
        staffUpdates.last_name = parts.slice(1).join(' ') || (parts[0] ?? '');
      }
      if (role !== undefined) {
        profileUpdates.role = role;
        profileUpdates.role_label = roleLabel ?? role;
        staffUpdates.role = role;
      }
      if (specialization !== undefined) {
        staffUpdates.specialization = specialization || null;
      }
      if (structureId !== undefined && isPlatformAdmin) {
        profileUpdates.structure_id = structureId || null;
        profileUpdates.structure_type = structureType || null;
      }

      let authAccountCreated = false;
      if (newPassword && String(newPassword).trim().length >= 6) {
        if (!authUserId) {
          const { rows: staffDataRows } = await adminPool.query(
            'SELECT email, first_name, last_name, role, structure_id FROM staff WHERE id = $1 LIMIT 1',
            [userId],
          );
          const staffData = staffDataRows[0];
          const targetEmail = (newEmail && String(newEmail).trim().toLowerCase()) || staffData?.email?.toLowerCase() || '';
          if (!targetEmail) {
            res.status(400).json({ error: 'Email requis pour créer un compte de connexion' });
            return;
          }

          authUserId = await createAuthUser(targetEmail, String(newPassword).trim());
          authAccountCreated = true;

          const fName = String(fullName ?? `${staffData?.first_name ?? ''} ${staffData?.last_name ?? ''}`).trim();
          const uRole = role ?? staffData?.role ?? 'staff';
          await adminPool.query(
            `INSERT INTO profiles (id, username, full_name, role, role_label, structure_id, structure_type)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (id) DO UPDATE SET
               username = EXCLUDED.username, full_name = EXCLUDED.full_name, role = EXCLUDED.role,
               role_label = EXCLUDED.role_label, structure_id = EXCLUDED.structure_id, structure_type = EXCLUDED.structure_type`,
            [authUserId, targetEmail, fName, uRole, roleLabel ?? uRole, staffData?.structure_id ?? structureId ?? null, structureType ?? null],
          );

          staffUpdates.email = targetEmail;
          delete profileUpdates.full_name;
          delete profileUpdates.role;
          delete profileUpdates.role_label;
        } else {
          await updateAuthUserPassword(authUserId, String(newPassword).trim());
        }
      }

      if (!authAccountCreated && newEmail && String(newEmail).trim().length > 0) {
        const cleanEmail = String(newEmail).trim().toLowerCase();
        if (authUserId) await updateAuthUserEmail(authUserId, cleanEmail);
        profileUpdates.username = cleanEmail;
        staffUpdates.email = cleanEmail;
      }

      if (authUserId && Object.keys(profileUpdates).length > 0) {
        const upd = buildUpdate('profiles', Object.keys(profileUpdates), profileUpdates, 'id', authUserId, 'id');
        if (upd) await adminPool.query(upd.text, upd.values);
      }
      if (Object.keys(staffUpdates).length > 0) {
        const upd = buildUpdate('staff', Object.keys(staffUpdates), staffUpdates, 'id', userId, 'id');
        if (upd) await adminPool.query(upd.text, upd.values);
      }

      res.json({ success: true });
      return;
    }

    if (action === 'suspend') {
      if (!authUserId) {
        res.status(400).json({ error: "Cet utilisateur n'a pas de compte de connexion — impossible de suspendre" });
        return;
      }
      await banUser(authUserId);
      res.json({ success: true });
      return;
    }

    if (action === 'activate') {
      if (!authUserId) {
        res.status(400).json({ error: "Cet utilisateur n'a pas de compte de connexion — impossible d'activer" });
        return;
      }
      await unbanUser(authUserId);
      res.json({ success: true });
      return;
    }

    if (action === 'delete') {
      if (authUserId) {
        await adminPool.query('DELETE FROM profiles WHERE id = $1', [authUserId]);
        await deleteAuthUser(authUserId);
      }
      await adminPool.query('DELETE FROM staff WHERE id = $1', [userId]);
      res.json({ success: true });
      return;
    }

    res.status(400).json({ error: `Action inconnue : ${action}` });
  }),
);

// ─── notify-patient ─────────────────────────────────────────────────────────
// Reste public (sans requireAuth), comme l'Edge Function d'origine : appelée
// à la fois par du personnel authentifié (approbation/rejet d'une demande
// portail) ET par PatientPortal.tsx pendant l'auto-inscription, où le patient
// n'a par définition pas encore de session — un vrai appelant anonyme
// légitime, pas seulement un vestige de l'ancienne gateway Supabase.

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('241')) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 9) return `+241${digits.slice(1)}`;
  if (digits.length === 8) return `+241${digits}`;
  return `+${digits}`;
}

function buildMessage(type: string, firstName: string, clinicName: string, portalUrl: string, reason?: string): string {
  const name = firstName.split(' ')[0];
  switch (type) {
    case 'registration':
      return (
        `✅ *Demande reçue !*\n\n` +
        `Bonjour ${name},\n` +
        `Votre demande d'accès à l'espace patient de *${clinicName}* a bien été enregistrée.\n\n` +
        `⏳ Notre équipe examinera votre dossier et vous confirmera l'accès sous 24 à 48h.\n\n` +
        `📱 Consultez votre espace : ${portalUrl}`
      );
    case 'approval':
      return (
        `🎉 *Compte validé !*\n\n` +
        `Bonjour ${name},\n` +
        `Votre accès à l'espace patient de *${clinicName}* a été validé.\n\n` +
        `Vous pouvez maintenant vous connecter et consulter vos rendez-vous, résultats et documents médicaux.\n\n` +
        `🔗 Accéder à mon espace : ${portalUrl}`
      );
    case 'rejection':
      return (
        `⚠️ *Demande non acceptée*\n\n` +
        `Bonjour ${name},\n` +
        `Votre demande d'accès à l'espace patient de *${clinicName}* n'a pas pu être acceptée.\n\n` +
        (reason ? `📋 Motif : ${reason}\n\n` : '') +
        `Pour plus d'informations, contactez directement la clinique.\n\n` +
        `📞 Nous sommes à votre disposition.`
      );
    default:
      return `Bonjour ${name}, message de ${clinicName}.`;
  }
}

async function sendTwilioSms(to: string, message: string): Promise<{ sent: boolean; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_SMS_FROM;
  if (!sid || !token || !from) return { sent: false, error: 'Twilio SMS non configuré' };

  const body = new URLSearchParams({ To: to, From: from, Body: message });
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) return { sent: false, error: `Twilio SMS error: ${await res.text()}` };
  return { sent: true };
}

async function sendTwilioWhatsApp(to: string, message: string): Promise<{ sent: boolean; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from) return { sent: false, error: 'Twilio WhatsApp non configuré' };

  const toWhatsapp = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const body = new URLSearchParams({ To: toWhatsapp, From: from, Body: message });
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) return { sent: false, error: `Twilio WhatsApp error: ${await res.text()}` };
  return { sent: true };
}

edgeFunctionsRouter.post(
  '/notify-patient',
  asyncHandler(async (req, res) => {
    const { type, phone, firstName, clinicName, portalUrl, reason, sendSms, sendWhatsapp } = req.body as Record<string, unknown>;

    if (!type || !phone || !firstName || !clinicName || !portalUrl) {
      res.status(400).json({ error: 'Paramètres manquants : type, phone, firstName, clinicName, portalUrl requis' });
      return;
    }

    const normalizedPhone = normalizePhone(String(phone));
    const message = buildMessage(String(type), String(firstName), String(clinicName), String(portalUrl), reason ? String(reason) : undefined);

    const waText = encodeURIComponent(message.replace(/\*/g, ''));
    const waLink = `https://wa.me/${normalizedPhone.replace('+', '')}?text=${waText}`;

    const results: Record<string, unknown> = { wa_link: waLink, phone: normalizedPhone };
    if (sendSms !== false) results.sms = await sendTwilioSms(normalizedPhone, message);
    if (sendWhatsapp !== false) results.whatsapp = await sendTwilioWhatsApp(normalizedPhone, message);

    res.json({ success: true, ...results });
  }),
);
