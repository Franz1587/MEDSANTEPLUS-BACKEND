import client from 'prom-client';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Durée des requêtes HTTP en secondes',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

export const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Nombre total de requêtes HTTP',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const uploadsDirBytes = new client.Gauge({
  name: 'uploads_dir_bytes',
  help: 'Taille totale du répertoire de stockage fichiers (/app/uploads) en octets',
  registers: [register],
});

/** Chemin de route normalisé (évite l'explosion de cardinalité avec des :id
 *  variables) — utilise req.route.path quand disponible (posé par Express
 *  après résolution du routeur), sinon retombe sur le chemin brut. */
function routeLabel(req: Request): string {
  const base = req.baseUrl || '';
  const routePath = (req.route as { path?: string } | undefined)?.path;
  return routePath ? `${base}${routePath}` : base || req.path;
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = { method: req.method, route: routeLabel(req), status_code: String(res.statusCode) };
    httpRequestDuration.observe(labels, durationSec);
    httpRequestTotal.inc(labels);
  });
  next();
}

function dirSize(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else {
      try { total += fs.statSync(full).size; } catch { /* fichier supprimé entre-temps */ }
    }
  }
  return total;
}

/** Recalcule périodiquement la taille du dossier uploads plutôt qu'à chaque
 *  scrape — un parcours récursif à chaque requête Prometheus serait coûteux. */
export function startUploadsDirWatcher(uploadRoot: string, intervalMs = 60_000) {
  const update = () => uploadsDirBytes.set(dirSize(uploadRoot));
  update();
  setInterval(update, intervalMs).unref();
}
