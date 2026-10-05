# Equipment Locker

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

A sports equipment borrowing system for a school or sports complex. Staff can track footballs, basketballs, volleyballs, badminton rackets, takraw balls, table tennis paddles, cricket bats, Muay Thai gloves and more: who borrowed what, how many are left, and what is overdue.

**Stack:** React + Vite (Azure Static Web Apps) , Node 20 + Express (Azure App Service) , Azure SQL Database. CI/CD with GitHub Actions.

## Data model

```
sports 1 ──< equipment 1 ──< loans
```

Stock is quantity-based and always shown in this order: **total -> on loan -> available**.

```
on_loan   = SUM(qty of loans not yet returned)
available = total_qty - on_loan
```

Stock status: `out_of_stock` when available is 0, `low_stock` when 25% or less of the total is left, otherwise `in_stock`.

## Business rules

| Rule | Response |
|---|---|
| Cannot borrow more than what is available | `409 insufficient_stock` |
| Due date must be today up to `MAX_LOAN_DAYS` (default 7) ahead | `400 invalid_due_date` |
| A borrower with an overdue loan cannot borrow again | `409 borrower_has_overdue` |
| Cannot set `total_qty` below the number currently borrowed | `409 qty_below_on_loan` |
| Equipment with loan history cannot be deleted (set total to 0 instead) | `409 equipment_has_loans` |
| A loan can only be returned or extended once / while open | `409 already_returned` |

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | health check |
| GET | `/sports` | list sports |
| GET | `/summary` | locker totals: units, on loan, available, out-of-stock items, overdue loans |
| GET | `/equipment?sport_id=&q=&stock=` | list equipment with `total_qty`, `on_loan_qty`, `available_qty`, `stock_status` (`in_stock` / `low_stock` / `out_of_stock`) |
| GET / POST | `/equipment`, `/equipment/:id` | read / **create** |
| PUT / DELETE | `/equipment/:id` | **update** / **delete** |
| GET | `/loans?status=active\|overdue\|returned` | list loans (status is derived) |
| POST | `/loans` | borrow |
| PUT | `/loans/:id` | edit borrower or extend due date |
| POST | `/loans/:id/return` | return equipment |
| DELETE | `/loans/:id` | delete a loan record |

## Run locally

```bash
cd server && npm install && cp .env.example .env     # paste AZURE_SQL_CONNECTION_STRING into .env
npm run dev                                          # http://localhost:8080
npm test                                             # 30 tests, no database needed

cd ../web && npm install && npm run dev              # http://localhost:5173
```

Without a connection string the API still starts; data routes answer `503 database_not_configured`.

## Deploy to Azure

1. **Resource group** `rg-locker-dev`.
2. **SQL Database** `lockerdb`: apply the free offer, set free-limit behavior to *AutoPause*. Allow Azure services in the server's Networking page. In Query editor run `db/schema.sql`, then `db/seed-data.sql`.
3. **App Service** `app-locker-api-dev` (Node 20 LTS, F1). Application settings:
   - `AZURE_SQL_CONNECTION_STRING` = ADO.NET string from the portal
   - `SCM_DO_BUILD_DURING_DEPLOYMENT` = `true`
   - `CORS_ORIGIN` = your Static Web App URL
   - Deployment Center -> GitHub -> this repo.
4. **Static Web App** `app-locker-web-dev`: preset Vite, app location `web`, output `dist`.
5. In the Static Web Apps workflow, add under the build step `env:` `VITE_API_URL: https://app-locker-api-dev.azurewebsites.net`.

### Fix the generated App Service workflow

The API lives in `server/`, but the workflow Azure generates assumes `package.json` is at the repo root. Edit it so it builds and uploads only `server/`:

```yaml
      - name: npm install
        working-directory: server
        run: npm ci --omit=dev
      - uses: actions/upload-artifact@v4
        with:
          name: node-app
          path: server
```

Also add `paths: ['server/**']` under `on.push` so web-only changes do not redeploy the API (and the reverse for the Static Web Apps workflow with `web/**`).

### Pipeline

`pull request -> ci.yml (check + tests + build) -> merge to main -> deploy API + deploy web`. Protect `main` so CI must pass before merging.

## Known limits (good "future work" for the report)

- Borrow checks stock then inserts; two simultaneous requests could both pass. Fix with a SQL transaction using `UPDLOCK`.
- No login. Add roles so only staff can delete.
- "Today" is UTC; adjust for Thailand time if needed.
