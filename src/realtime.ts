import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Client as PgClient } from 'pg';
import { verifyToken } from './auth.js';

/**
 * Relais temps réel — remplace Supabase Realtime. Les tables portant le
 * trigger notify_realtime_change() (voir migration realtime_triggers.sql,
 * appliquée uniquement sur medsanteplus-pg-local) envoient un pg_notify sur
 * le canal 'realtime_changes' à chaque INSERT/UPDATE/DELETE. On maintient
 * une connexion LISTEN dédiée (jamais depuis le pool applicatif — une
 * connexion en LISTEN doit rester ouverte indéfiniment) et on relaie un
 * message minimal aux clients WebSocket concernés, qui déclenchent un
 * simple refetch — même principe que l'actuel `trigger('stockItems')` côté
 * frontend, pas de synchronisation ligne par ligne.
 */

interface ClientInfo {
  ws: WebSocket;
  structureId: string | null;
}

const clients = new Set<ClientInfo>();

export function attachRealtime(server: HttpServer) {
  // Chemin /api/realtime (et non /realtime) : medsanteplus.net sert encore
  // aujourd'hui /realtime/* vers le Supabase Realtime historique (Caddyfile),
  // donc /realtime tout court entrerait en collision une fois les deux
  // backends exposés sous le même domaine.
  const wss = new WebSocketServer({ server, path: '/api/realtime' });

  wss.on('connection', (ws) => {
    const info: ClientInfo = { ws, structureId: null };
    clients.add(info);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; token?: string; structureId?: string };
        if (msg.type === 'auth') {
          const user = msg.token ? verifyToken(msg.token) : null;
          if (!user) { ws.close(4001, 'Non authentifié'); return; }
          info.structureId = msg.structureId ?? null;
          ws.send(JSON.stringify({ type: 'auth_ok' }));
        }
      } catch {
        // message malformé — ignoré silencieusement, pas de crash du relais
      }
    });

    ws.on('close', () => clients.delete(info));
  });

  const pgClient = new PgClient({ connectionString: process.env.ADMIN_DATABASE_URL });
  pgClient.connect().then(() => {
    pgClient.query('LISTEN realtime_changes');
    console.log('[realtime] LISTEN realtime_changes actif');
  }).catch((err) => {
    console.error('[realtime] échec connexion LISTEN:', err);
  });

  pgClient.on('notification', (msg) => {
    if (!msg.payload) return;
    let payload: { table: string; structure_id: string | null; op: string };
    try {
      payload = JSON.parse(msg.payload);
    } catch {
      return;
    }
    const data = JSON.stringify({ type: 'change', table: payload.table, op: payload.op });
    for (const c of clients) {
      // structure_id null = table de référence globale (ex: insurance_companies)
      // → diffusée à tout le monde ; sinon uniquement aux clients de cette structure.
      const matches = payload.structure_id === null || c.structureId === payload.structure_id;
      if (matches && c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
    }
  });

  pgClient.on('error', (err) => {
    console.error('[realtime] erreur connexion LISTEN:', err);
  });
}
