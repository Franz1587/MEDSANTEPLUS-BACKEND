import { Router } from 'express';
import { withUserContext } from '../db.js';
import { requireAuth } from '../auth.js';
import { asyncHandler, buildInsert, buildUpdate } from '../util.js';

export const sagefemmeRouter = Router();
sagefemmeRouter.use(requireAuth);

/** Génère un petit CRUD (list-by-structure, list-by-related, create, update)
 *  pour une table sf_* — même logique que simpleCrudRouter mais montée en
 *  sous-chemins (grossesses/, accouchements/...) au lieu de routeurs séparés,
 *  et avec un embed JOIN optionnel pour reproduire les .select('*, x:y(...)')
 *  de src/lib/db/sagefemme.ts. */
function mountSfCrud(opts: {
  path: string; table: string; columns: readonly string[];
  listSelect: string; listFrom?: string; orderBy: string;
  /** Qualifie structure_id quand listFrom joint une autre table qui a aussi
   *  cette colonne (ex: patients) — évite une référence ambiguë en SQL. */
  whereStructureCol?: string;
  relatedColumn?: string; relatedSelect?: string; relatedFrom?: string;
}) {
  const base = `/${opts.path}`;
  sagefemmeRouter.get(`${base}`, asyncHandler(async (req, res) => {
    const { structureId } = req.query as { structureId?: string };
    if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
    const rows = await withUserContext(req.authUser!, (client) =>
      client.query(
        `SELECT ${opts.listSelect} FROM ${opts.listFrom ?? opts.table} WHERE ${opts.whereStructureCol ?? 'structure_id'} = $1 ORDER BY ${opts.orderBy}`,
        [structureId],
      ).then((r) => r.rows),
    );
    res.json(rows);
  }));

  if (opts.relatedColumn) {
    sagefemmeRouter.get(`${base}/by-${opts.relatedColumn}/:value`, asyncHandler(async (req, res) => {
      const rows = await withUserContext(req.authUser!, (client) =>
        client.query(
          `SELECT ${opts.relatedSelect ?? '*'} FROM ${opts.relatedFrom ?? opts.table} WHERE ${opts.relatedColumn} = $1 ORDER BY ${opts.orderBy}`,
          [req.params.value],
        ).then((r) => r.rows),
      );
      res.json(rows);
    }));
  }

  sagefemmeRouter.post(`${base}`, asyncHandler(async (req, res) => {
    const row = await withUserContext(req.authUser!, async (client) => {
      const insert = buildInsert(opts.table, opts.columns, req.body);
      const { rows } = await client.query(insert.text, insert.values);
      return rows[0];
    });
    res.status(201).json(row);
  }));

  sagefemmeRouter.patch(`${base}/:id`, asyncHandler(async (req, res) => {
    const row = await withUserContext(req.authUser!, async (client) => {
      const update = buildUpdate(opts.table, [...opts.columns, 'updated_at'], { ...req.body, updated_at: new Date().toISOString() }, 'id', req.params.id);
      if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
      const { rows } = await client.query(update.text, update.values);
      return rows[0];
    });
    res.json(row);
  }));
}

// -- GROSSESSES (avec patient joint) ------------------------------------------
mountSfCrud({
  path: 'grossesses', table: 'sf_grossesses',
  columns: ['structure_id', 'patient_id', 'sage_femme_id', 'date_debut', 'date_dernieres_regles', 'terme_prevu', 'nombre_foetus', 'grossesse_a_risque', 'motif_risque', 'gestite', 'parite', 'antecedents_obstetricaux', 'groupe_sanguin', 'facteurs_risque', 'statut', 'notes', 'created_by'],
  listSelect: `g.*, CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('first_name', p.first_name, 'last_name', p.last_name, 'date_of_birth', p.date_of_birth, 'phone', p.phone) END AS patient`,
  listFrom: 'sf_grossesses g LEFT JOIN patients p ON p.id = g.patient_id',
  whereStructureCol: 'g.structure_id',
  orderBy: 'g.created_at DESC',
  relatedColumn: 'patient_id',
});

// -- SUIVI GROSSESSE -----------------------------------------------------------
sagefemmeRouter.get('/suivi-grossesse/by-grossesse/:grossesseId', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM sf_suivi_grossesse WHERE grossesse_id = $1 ORDER BY date_consultation DESC', [req.params.grossesseId])
      .then((r) => r.rows),
  );
  res.json(rows);
}));
sagefemmeRouter.post('/suivi-grossesse', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('sf_suivi_grossesse', ['grossesse_id', 'structure_id', 'sage_femme_id', 'date_consultation', 'terme_sa', 'terme_jours', 'poids_kg', 'tension_systolique', 'tension_diastolique', 'hauteur_uterine_cm', 'bcf_bpm', 'oedemes', 'examen_clinique', 'symptomes', 'examens_prescrits', 'echographie', 'prescriptions_ids', 'prochaine_visite', 'statut', 'notes'], req.body);
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));
sagefemmeRouter.patch('/suivi-grossesse/:id', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const update = buildUpdate('sf_suivi_grossesse', ['sage_femme_id', 'date_consultation', 'terme_sa', 'terme_jours', 'poids_kg', 'tension_systolique', 'tension_diastolique', 'hauteur_uterine_cm', 'bcf_bpm', 'oedemes', 'examen_clinique', 'symptomes', 'examens_prescrits', 'echographie', 'prescriptions_ids', 'prochaine_visite', 'statut', 'notes', 'updated_at'], { ...req.body, updated_at: new Date().toISOString() }, 'id', req.params.id);
    if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
    const { rows } = await client.query(update.text, update.values);
    return rows[0];
  });
  res.json(row);
}));

// -- ACCOUCHEMENTS (avec patient + nouveau_nes joints) -------------------------
sagefemmeRouter.get('/accouchements', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query(
      `SELECT a.*,
              CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('first_name', p.first_name, 'last_name', p.last_name) END AS patient,
              COALESCE((SELECT json_agg(n.*) FROM sf_nouveau_ne n WHERE n.accouchement_id = a.id), '[]') AS nouveau_nes
       FROM sf_accouchements a
       LEFT JOIN patients p ON p.id = a.patient_id
       WHERE a.structure_id = $1
       ORDER BY a.date_heure_accouchement DESC`,
      [structureId],
    ).then((r) => r.rows),
  );
  res.json(rows);
}));
sagefemmeRouter.post('/accouchements', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('sf_accouchements', ['grossesse_id', 'structure_id', 'patient_id', 'sage_femme_id', 'date_heure_arrivee', 'date_heure_debut_travail', 'date_heure_rupture_membranes', 'date_heure_accouchement', 'mode_accouchement', 'presentation', 'liquide_amniotique', 'episiotomie', 'dechirure_degre', 'suture_perinee', 'delivrance', 'heure_delivrance', 'pertes_sang_ml', 'complications', 'gestes_realises', 'medicaments_administres', 'statut', 'notes'], req.body);
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));
sagefemmeRouter.patch('/accouchements/:id', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const update = buildUpdate('sf_accouchements', ['date_heure_arrivee', 'date_heure_debut_travail', 'date_heure_rupture_membranes', 'date_heure_accouchement', 'mode_accouchement', 'presentation', 'liquide_amniotique', 'episiotomie', 'dechirure_degre', 'suture_perinee', 'delivrance', 'heure_delivrance', 'pertes_sang_ml', 'complications', 'gestes_realises', 'medicaments_administres', 'statut', 'notes', 'updated_at'], { ...req.body, updated_at: new Date().toISOString() }, 'id', req.params.id);
    if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
    const { rows } = await client.query(update.text, update.values);
    return rows[0];
  });
  res.json(row);
}));

// -- PARTOGRAMME ----------------------------------------------------------------
sagefemmeRouter.get('/partogramme/by-accouchement/:accouchementId', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM sf_partogramme WHERE accouchement_id = $1 ORDER BY date_heure ASC', [req.params.accouchementId])
      .then((r) => r.rows),
  );
  res.json(rows);
}));
sagefemmeRouter.post('/partogramme', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('sf_partogramme', ['accouchement_id', 'structure_id', 'date_heure', 'dilatation_cm', 'station', 'bcf_bpm', 'contractions_freq', 'contractions_duree_s', 'tension_systolique', 'tension_diastolique', 'temperature_c', 'pouls', 'analgesie', 'liquide_amniotique', 'medicaments', 'observations'], req.body);
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));

// -- NOUVEAU-NÉS ------------------------------------------------------------
sagefemmeRouter.get('/nouveau-nes/by-accouchement/:accouchementId', asyncHandler(async (req, res) => {
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query('SELECT * FROM sf_nouveau_ne WHERE accouchement_id = $1', [req.params.accouchementId]).then((r) => r.rows),
  );
  res.json(rows);
}));
sagefemmeRouter.post('/nouveau-nes', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('sf_nouveau_ne', ['accouchement_id', 'structure_id', 'patient_id', 'prenom', 'sexe', 'poids_grammes', 'taille_cm', 'perimetre_cranien_cm', 'apgar_1min', 'apgar_5min', 'apgar_10min', 'reanimation', 'gestes_reanimation', 'malformations', 'observations_malformations', 'allaitement', 'transfert', 'motif_transfert', 'observations'], req.body);
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));
sagefemmeRouter.patch('/nouveau-nes/:id', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const update = buildUpdate('sf_nouveau_ne', ['prenom', 'sexe', 'poids_grammes', 'taille_cm', 'perimetre_cranien_cm', 'apgar_1min', 'apgar_5min', 'apgar_10min', 'reanimation', 'gestes_reanimation', 'malformations', 'observations_malformations', 'allaitement', 'transfert', 'motif_transfert', 'observations', 'updated_at'], { ...req.body, updated_at: new Date().toISOString() }, 'id', req.params.id);
    if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
    const { rows } = await client.query(update.text, update.values);
    return rows[0];
  });
  res.json(row);
}));

// -- POST-PARTUM ------------------------------------------------------------
mountSfCrud({
  path: 'postpartum', table: 'sf_postpartum',
  columns: ['accouchement_id', 'structure_id', 'patient_id', 'sage_femme_id', 'date_visite', 'type_visite', 'involution_uterine', 'lochies', 'perinee_etat', 'allaitement_etat', 'etat_psychologique', 'tension_arterielle', 'temperature_c', 'examens_bebe', 'prescriptions_sortie', 'recommandations', 'statut', 'notes'],
  listSelect: '*', orderBy: 'date_visite DESC',
});

// -- CONSULTATIONS GYNÉCO (avec patient joint) ---------------------------------
sagefemmeRouter.get('/consultations-gyneco', asyncHandler(async (req, res) => {
  const { structureId } = req.query as { structureId?: string };
  if (!structureId) { res.status(400).json({ error: 'structureId requis' }); return; }
  const rows = await withUserContext(req.authUser!, (client) =>
    client.query(
      `SELECT c.*, CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('first_name', p.first_name, 'last_name', p.last_name, 'date_of_birth', p.date_of_birth) END AS patient
       FROM sf_consultations_gyneco c LEFT JOIN patients p ON p.id = c.patient_id
       WHERE c.structure_id = $1 ORDER BY c.date_consultation DESC`,
      [structureId],
    ).then((r) => r.rows),
  );
  res.json(rows);
}));
sagefemmeRouter.post('/consultations-gyneco', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const insert = buildInsert('sf_consultations_gyneco', ['structure_id', 'patient_id', 'sage_femme_id', 'date_consultation', 'motif', 'examen_clinique', 'frottis_realise', 'resultat_frottis', 'echographie', 'contraception_actuelle', 'type_contraception', 'pose_retrait', 'date_pose', 'date_retrait_prevue', 'ists_depistage', 'diabete_gestationnel', 'diagnostic', 'traitement', 'prochaine_visite', 'statut', 'notes'], req.body);
    const { rows } = await client.query(insert.text, insert.values);
    return rows[0];
  });
  res.status(201).json(row);
}));
sagefemmeRouter.patch('/consultations-gyneco/:id', asyncHandler(async (req, res) => {
  const row = await withUserContext(req.authUser!, async (client) => {
    const update = buildUpdate('sf_consultations_gyneco', ['motif', 'examen_clinique', 'frottis_realise', 'resultat_frottis', 'echographie', 'contraception_actuelle', 'type_contraception', 'pose_retrait', 'date_pose', 'date_retrait_prevue', 'ists_depistage', 'diabete_gestationnel', 'diagnostic', 'traitement', 'prochaine_visite', 'statut', 'notes', 'updated_at'], { ...req.body, updated_at: new Date().toISOString() }, 'id', req.params.id);
    if (!update) throw Object.assign(new Error('Aucun champ à mettre à jour'), { status: 400 });
    const { rows } = await client.query(update.text, update.values);
    return rows[0];
  });
  res.json(row);
}));

// -- COMPTES-RENDUS -----------------------------------------------------------
mountSfCrud({
  path: 'comptes-rendus', table: 'sf_comptes_rendus',
  columns: ['structure_id', 'patient_id', 'sage_femme_id', 'type_document', 'reference_id', 'reference_table', 'titre', 'contenu', 'fichier_url', 'statut', 'horodatage'],
  listSelect: '*', orderBy: 'horodatage DESC',
});
