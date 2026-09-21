import { Router } from 'express';
import { authenticatePartner, requireScope, type PartnerContext } from '../partner/auth.js';
import { logCall } from '../partner/audit.js';
import type { HandlerResult } from '../partner/types.js';
import { getEligibility, listSubscribers, createSubscriber, getTariffs, listClinics } from '../partner/catalog.js';
import { listInvoices, getInvoice, updateInvoiceStatus } from '../partner/invoices.js';
import { listClaims, getClaim, updateClaimStatus } from '../partner/claims.js';
import { createAppointmentRequest, getAppointmentRequest, listAppointments } from '../partner/appointments.js';

/**
 * Portage de supabase/functions/partner-api/index.ts — passerelle pour
 * applications partenaires externes, authentifiée par clé API (jamais par
 * JWT applicatif). Monté à la racine sous /partner-api (voir index.ts), pas
 * sous /api, pour rester le plus proche possible de l'URL que les
 * partenaires existants appelaient déjà côté Supabase.
 */

export const partnerApiRouter = Router();

type Route = {
  method: string;
  pattern: string[];
  scope: string;
  handle: (ctx: PartnerContext, params: Record<string, string>, url: URL, body: Record<string, unknown>) => Promise<HandlerResult>;
};

const routes: Route[] = [
  { method: 'GET', pattern: ['eligibility'], scope: 'eligibility:read', handle: (ctx, _p, url) => getEligibility(url, ctx) },
  { method: 'GET', pattern: ['subscribers'], scope: 'subscribers:read', handle: (_ctx, _p, url) => listSubscribers(url) },
  { method: 'POST', pattern: ['subscribers'], scope: 'subscribers:write', handle: (_ctx, _p, _url, body) => createSubscriber(body) },
  { method: 'GET', pattern: ['tariffs'], scope: 'tariffs:read', handle: (_ctx, _p, url) => getTariffs(url) },
  { method: 'GET', pattern: ['clinics'], scope: 'clinics:read', handle: (ctx) => listClinics(ctx) },
  { method: 'GET', pattern: ['invoices'], scope: 'invoices:read', handle: (ctx, _p, url) => listInvoices(url, ctx, false) },
  { method: 'GET', pattern: ['invoices', ':id'], scope: 'invoices:read', handle: (ctx, p) => getInvoice(p.id, ctx, false) },
  { method: 'GET', pattern: ['invoices', ':id', 'items'], scope: 'invoices:detail:read', handle: (ctx, p) => getInvoice(p.id, ctx, true) },
  { method: 'PATCH', pattern: ['invoices', ':id', 'status'], scope: 'invoices:status:write', handle: (ctx, p, _url, body) => updateInvoiceStatus(p.id, ctx, body) },
  { method: 'GET', pattern: ['claims'], scope: 'claims:read', handle: (ctx, _p, url) => listClaims(url, ctx) },
  { method: 'GET', pattern: ['claims', ':id'], scope: 'claims:read', handle: (ctx, p) => getClaim(p.id, ctx) },
  { method: 'PATCH', pattern: ['claims', ':id', 'status'], scope: 'claims:status:write', handle: (ctx, p, _url, body) => updateClaimStatus(p.id, ctx, body) },
  { method: 'POST', pattern: ['appointments', 'requests'], scope: 'appointments:request:write', handle: (ctx, _p, _url, body) => createAppointmentRequest(ctx, body) },
  { method: 'GET', pattern: ['appointments', 'requests', ':ref'], scope: 'appointments:request:read', handle: (ctx, p) => getAppointmentRequest(p.ref, ctx) },
  { method: 'GET', pattern: ['appointments'], scope: 'appointments:read', handle: (ctx, _p, url) => listAppointments(url, ctx) },
];

function matchRoute(method: string, segments: string[]): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < route.pattern.length; i++) {
      const part = route.pattern[i];
      if (part.startsWith(':')) params[part.slice(1)] = segments[i];
      else if (part !== segments[i]) { matched = false; break; }
    }
    if (matched) return { route, params };
  }
  return null;
}

partnerApiRouter.use(async (req, res) => {
  const start = Date.now();
  const url = new URL(req.originalUrl, 'http://internal');
  const segments = req.path.split('/').filter(Boolean);

  if (segments[0] === 'ping') {
    res.json({ ok: true, service: 'partner-api', time: new Date().toISOString() });
    return;
  }

  const auth = await authenticatePartner(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const ctx = auth.ctx;

  const matched = matchRoute(req.method, segments);
  if (!matched) {
    res.status(404).json({ error: `Route inconnue : ${req.method} /${segments.join('/')}` });
    return;
  }

  const scopeErr = requireScope(ctx, matched.route.scope);
  if (scopeErr && !scopeErr.ok) {
    res.status(scopeErr.status).json({ error: scopeErr.error });
    return;
  }

  const body = (req.body as Record<string, unknown>) ?? {};

  let result: HandlerResult;
  try {
    result = await matched.route.handle(ctx, matched.params, url, body);
  } catch (err) {
    console.error('[partner-api] handler error:', err);
    result = { status: 500, body: { error: 'Erreur interne' } };
  }

  await logCall({
    partnerKeyId: ctx.keyId,
    method: req.method,
    route: `/${segments.join('/')}`,
    statusCode: result.status,
    durationMs: Date.now() - start,
    structureId: result.structureId,
    resourceType: result.resourceType,
    resourceId: result.resourceId,
    changedFields: result.changedFields,
    errorMessage: result.status >= 400 ? JSON.stringify(result.body) : null,
  });

  res.status(result.status).json(result.body);
});
