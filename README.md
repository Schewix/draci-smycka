# Dračí smyčka

Samostatná aplikace pro uzlovou soutěž Dračí smyčka. Projekt zahrnuje databázi
na Supabase, Express API a webovou aplikaci s rolemi rozhodčí, výpočetka a
administrátor. Nasazuje se pod basePath `/draci-smycka` (např.
`https://zelenaliga.cz/draci-smycka`).

## Struktura repozitáře

- `supabase/sql/` – schema, pohledy, RLS politiky a seed pro výchozí konfiguraci
  uzlů a kategorií.
- `server/` – Express backend (autentizace, správa pokusů, audit, leaderboardy).
- `web/` – React/Vite front-end pro přihlášené role i veřejný leaderboard.
- `scripts/` – utilita pro generování QR archů závodníků.

## Supabase

1. Proveď migraci schématu:

   ```bash
   psql "$SUPABASE_DB_URL" -f supabase/sql/schema.sql
   psql "$SUPABASE_DB_URL" -f supabase/sql/views.sql
   psql "$SUPABASE_DB_URL" -f supabase/sql/rls.sql
   psql "$SUPABASE_DB_URL" -f supabase/sql/draci_seed.sql  # volitelné výchozí uzly
   ```

2. Vytvoř service role klíč (pro backend) a anon klíč (pro veřejné dotazy).

## Backend (Express)

```bash
cd server
npm install
npm run dev
```

Konfigurace (`server/.env`):

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
JWT_SECRET=<random>
REFRESH_TOKEN_SECRET=<random>
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=1209600
```

### REST API přehled

- `POST /auth/login` – přihlášení, vrací access/refresh tokeny a manifest
  kategorií/uzlů pro roli.
- `POST /auth/refresh` – obnoví tokeny, pokud je refresh token platný.
- `POST /auth/logout` – odhlásí sezení.
- `GET /judge/competitors/lookup?token=` – rozhodčí zjistí závodníka podle QR.
- `POST /judge/attempts` – zápis pokusu (čas nebo 333) se zamykáním prvního
  pokusu.
- `GET /calculator/competitors/:id` – výpočetka načte celé „papírky“ uzlů.
- `PUT /calculator/attempts/:attemptId` – úprava existujícího pokusu.
- `GET /calculator/competitors/lookup?token=` – mapování QR → závodník.
- `GET /admin/events/:eventId/context` – přehled kategorií, uzlů a statistik.
- `POST /admin/events/:eventId/competitors` – registrace soutěžícího (volitelně s
  QR tokenem).
- `POST /admin/competitors/:competitorId/token` – generování nebo obnova QR.
- `GET /leaderboard/events/:slug` – agregované výsledky pro veřejný leaderboard.

Každá úprava pokusu nebo tokenu se loguje do `attempt_audit_logs` s údajem o
uživateli, roli a IP adrese.

## Web (React + Vite)

```bash
cd web
npm install
npm run dev
```

Konfigurace (`web/.env`):

```
VITE_API_BASE_URL=http://localhost:8787
```

Aplikace využívá `BrowserRouter` s base path `/draci-smycka`. Role a jejich
funkce:

- **Rozhodčí** – načtení závodníka přes QR/token, zápis časů a 333.
- **Výpočetka** – přehled všech uzlů závodníka, úpravy pokusů s okamžitým
  přepočtem.
- **Admin** – správa kategorií/uzlů (read-only overview) a registrace závodníků
  včetně QR tokenů.
- **Veřejnost** – leaderboard s pořadím v kategoriích a zvlášť pro štafetu.

### QR generátor

```
npm run node scripts/generate-qr-codes.mjs <EVENT_ID> [output-dir]
```

Skript načte závodníky se zadaným `event_id`, ověří jejich `qr_token` a vytvoří
SVG i PDF arch s QR kódy. URL v QR kódu má tvar
`https://zelenaliga.cz/draci-smycka?t=<token>` (lze změnit proměnnou
`QR_BASE_DOMAIN`).

## Poznámky k nasazení

- Front-end očekává, že bude dostupný na `/draci-smycka`. Uprav `vite.config.ts`
  pokud je třeba jiný prefix.
- Leaderboard dotahuje data z backendu – expose endpoint i pro veřejnost.
- Pro produkci doporučujeme nastavit HTTPS a reverse proxy na Express API.
