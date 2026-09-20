# medsanteplus-backend

Backend Node/TypeScript dédié à MedSanté+ — remplace la stack Supabase
(PostgREST/GoTrue/Realtime/Kong) par une API applicative connectée
directement à Postgres via `pg`, en conservant les politiques RLS
existantes (isolation multi-établissement + rôles) grâce à un `SET LOCAL`
posé par requête (voir `src/db.ts`).

## Développement

```bash
npm install
cp .env.example .env   # renseigner DATABASE_URL
npm run dev
```

## Déploiement

Construit via `Dockerfile`, déployé comme application Coolify dans le
projet **MEDSANTE+**.
