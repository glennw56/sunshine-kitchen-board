# Sunshine kitchen board

Phone and tablet bake-day board for Sunshine's Bakery. A recipe is a finished item, a batch, a due time, and the steps that get it there. Staff claim, start, and finish today's tickets. Finishing deducts raw ingredients and adds cooked goods in the same inventory the shop already trusts. There is no second stock database.

This repository deploys **only** the Cloud Run test service `sunshine-kitchen-board-test` in project `bakery-444323`, region `us-east1`. It does not promote anything to production.

## What v1 includes

Four tabs. A phone keeps a bottom bar and a single column of tickets. A counter tablet (about 768px wide and tall enough to sit on the pass) gets its own frame: a side rail, larger type, and Claim / Start / Done as three equal glove-sized buttons. Phone landscape stays on the phone layout so a short screen is not a squeezed tablet.

1. **Board** — a day schedule headed **Today**, then cooks currently clocked in when the time clock answers, then a flat list ordered by start time (due minus prep). Each line is the start time and the task name. Tap a row to claim, start, or finish. Done asks how many were made; that amount is what gets added to the finished SKU and to Square Test Cook. Shortage warning before start. The same screen still shows bake-day raw on-hand and cooked/finished counts for SKUs tied to today's recipes.
2. **Raw** — on-hand and small kitchen adjustments for those same today's ingredients, read and written through sunshine-inventory-test. Link recipe lines to SKUs that already exist. Full CSV, recounts, and catalog browsing stay in the inventory app.
3. **Cooked** — add, remove, and pull for today's finished SKUs that already exist in the tax-exempt inventory catalog. Unknown SKUs are refused.
4. **Live** — read-only who's punched in and recent punches from the Sunshine time clock. Filter by store (Irondale by default) and keep the kitchen view on cooks. This app never clocks anyone in or out.

Also in v1: Slack recipe read (`/recipe`), overdue sound on an open board, Slack auto-alert after a 10 minute buffer, re-alert every 15 minutes, and a Square inventory adjustment on the single item **Test Cook**.

Not in v1, and not in this PR: full ERP, auto-ordering, Square sales metrics, cook predictions, and demand forecasting. That phase starts only after v1 is live. Also out: multi-location inventory and clock-in on this app.

## Local setup

```bash
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:3000. The dev default `INVENTORY_TRANSPORT=file` copies `fixtures/dev-catalog.json` into `data/dev-catalog.json` so the board is usable before inventory credentials exist. That file is a local stand-in. Production deploy forces `INVENTORY_TRANSPORT=http` against the inventory test app.

On first boot the owner password is generated (scrypt hash in `data/admin.json`). The plaintext is written once to `data/owner-password.txt`. Hand that to the owner, then delete the file. It is gitignored. Reset anytime with:

```bash
npm run admin:reset
```

Default email: `glenn.will799@gmail.com`.

### Tests

```bash
npm test
```

## Environment

| Variable | Purpose |
| --- | --- |
| `AUTH_SECRET` | Signs staff and owner cookies. At least 16 characters. Required in production. |
| `DATA_DIR` | JSON store. Local default `./data`. Cloud Run `/data`. |
| `ADMIN_EMAIL` | Owner email. Default `glenn.will799@gmail.com`. |
| `ADMIN_INITIAL_PASSWORD` | Optional first-boot password. If empty, a random one is written to `owner-password.txt`. |
| `INVENTORY_TRANSPORT` | `file`, `http`, `gcs`, or `auto`. Deploy uses `http`. |
| `INVENTORY_BASE_URL` | `https://sunshine-inventory-test-k6uuoen7wa-ue.a.run.app` |
| `INVENTORY_EMAIL` / `INVENTORY_PASSWORD` | Admin login for the inventory test app (same account that can open the shop). Also sent as HTTP Basic to `POST /api/import`. |
| `INVENTORY_GCS_BUCKET` | Optional. `bakery-444323-sunshine-inventory-test` if the kitchen board service account may read and write `data/catalog.json`. |
| `INVENTORY_GCS_OBJECT` | Default `data/catalog.json`. |
| `TIMECLOCK_BASE_URL` | Live clock `https://sunshine-timeclock-k6uuoen7wa-ue.a.run.app`. Test clock: `https://sunshine-timeclock-test-k6uuoen7wa-ue.a.run.app`. |
| `TIMECLOCK_IDENTIFIER` / `TIMECLOCK_PASSWORD` | Read-only login. An admin user is required for the whole-floor timesheet. |
| `TIMECLOCK_DEFAULT_STORE` | `Irondale`. Used when a punch has no store field. |
| `SLACK_BOT_TOKEN` | Bot token with `chat:write` and `commands`. |
| `SLACK_SIGNING_SECRET` | Verifies slash commands and events. |
| `SLACK_CHANNEL_ID` | The only channel auto-alerts and nudges post to. |
| `SLACK_ASSIGNEE_MAP` | Optional JSON map of staff name to Slack user id, for mentions. |
| `SQUARE_ACCESS_TOKEN` | Token for the Square account that owns Irondale. Inventory API only. |
| `SQUARE_API_BASE` | `https://connect.squareup.com` or `https://connect.squareupsandbox.com` for a sandbox token. |
| `PUBLIC_BASE_URL` | Board URL placed in Slack recipe messages. |
| `CRON_SECRET` | Optional. Lets Cloud Scheduler call `POST /api/alerts` without a staff cookie. |
| `OVERDUE_BUFFER_MINUTES` | Default **10**. Owner screen can change the stored value. |
| `REALERT_MINUTES` | Default **15**. One auto Slack per overdue ticket per interval. |

Timezone is `America/Chicago` everywhere.

## Inventory integration

Discovered on the live test service (no guessed write API beyond what the app actually exposes):

- `GET /api/health` is public. It reports `service: sunshine-inventory-test`, `dataDir: /data`, and files `catalog.json`, `orders.json`, `recounts.json`, `suppliers.json`, `settings.json`, `admin.json`.
- `POST /api/import` is the machine write route. Without credentials it returns `401` and `{"ok":false,"error":"Admin sign-in required"}` with `WWW-Authenticate: Basic realm="Sunshine inventory"`.
- The shop UI is a Next.js server-action login (email + password). Other `/api/*` paths redirect to `/login`.
- Catalog JSON lives at `gs://bakery-444323-sunshine-inventory-test/data/catalog.json` (not anonymously readable).

The HTTP client signs in with the same server-action the shop uses, reads catalog rows from the authenticated payload (or from a JSON export if one is returned), and writes by `POST /api/import`. A full-document write happens only when the read returned a JSON document that can be round-tripped. Otherwise a delta body is posted and the server's error is shown. SKUs that are not already in the catalog are never created.

`INVENTORY_TRANSPORT=gcs` updates `onHand` in that same `catalog.json` and refuses missing SKUs. Use it only if this service account is allowed to write the inventory test bucket.

Cooked moves require a catalog SKU whose category looks like finished/cooked/baked, or a SKU that is a recipe's finished item. Raw deduct on Done uses catalog SKUs only.

## Time clock integration

Discovered on `sunshine-timeclock` and `sunshine-timeclock-test` (both answer `GET /api/health`):

- Auth is Auth.js: `GET /api/auth/csrf`, `GET /api/auth/providers`, `POST /api/auth/callback/credentials` with `identifier` and `password`.
- Pages: `/login`, `/register`, `/` (your own punches), `/admin` (timesheet `rows` + `staff`), `/admin/schedule` (shifts with optional `role`), `/admin/labor`.
- There is no public punches JSON API. This app reads the admin RSC payload. It does **not** call clock-in or clock-out.

Role comes from the scheduled shift when the punch itself has none. Kitchen view keeps `cook`, `kitchen`, `baker`, `pastry`, `prep`, and people with no role (tagged untagged). Front-of-house roles stay out of that view so they do not dominate the list. Store filter defaults to Irondale. Punches without a store are tagged with `TIMECLOCK_DEFAULT_STORE` so a second store can be added later without a schema change here.

Punch notifications are stubbed. Late-task Slack is implemented.

## Square — Test Cook only

The owner already created the item. This app does **not** create, update, or delete Square catalog objects, and it does not change any other item's stock.

| Field | Value |
| --- | --- |
| Item name | Test Cook |
| Catalog item id | `YENSLXSY5HTO74CADKBSQ5CA` |
| Variation id | `HRFLTIDM2ZHZNXN4N4EN6WFQ` |
| SKU | `C517188` |
| Location | `L4CK6YWGT5XQX` (Sunshine's Bakery Irondale, active) |
| Never use | `L6XDJSQS6NY54` (Homebased, inactive) |

On cooked add, remove, pull, and when a ticket is marked done, the app calls:

`POST /v2/inventory/batch-change`

with `type: ADJUSTMENT` for variation `HRFLTIDM2ZHZNXN4N4EN6WFQ` at `L4CK6YWGT5XQX` only.

- Increase: `from_state NONE` → `to_state IN_STOCK`
- Decrease (remove and pull): `from_state IN_STOCK` → `to_state WASTE`

Done sends the cook's amount made (not the planned yield) as the Test Cook adjustment, and adds that same amount to the finished SKU. Raw ingredients still come out by the recipe batch. The Square client throws if a request path is anything except that batch-change or a count read of this variation, or if the body mentions another id or the Homebased location. It does not read Square sales, orders, or catalog, and it does not forecast demand. The current sellable/ecom flags are left as the owner created them.

Set `SQUARE_ACCESS_TOKEN` to a token for that Square account. A missing token is reported on the ticket; inventory still moves so the catalog check can be verified separately. Use **Retry Square** on the card if inventory moved and Square did not.

## Slack

Create a Slack app for the kitchen workspace:

1. Bot token scopes: `commands`, `chat:write`.
2. Slash command `/recipe` (and `/board` if you want the same list) pointing at `https://<board>/api/slack/commands`.
3. Event subscription request URL `https://<board>/api/slack/events` (URL verification only; the board does not need extra events).
4. Install the app to the workspace. Put the bot in the kitchen channel.
5. Set `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_CHANNEL_ID`, and `PUBLIC_BASE_URL`.

`/recipe` with no text lists today's tickets (ephemeral, so it does not post into a random channel). `/recipe croissant` (or cookie, sourdough, or part of the name) shows the batch, due time, ingredients, and ordered steps with minutes, station, and which step moves stock, plus a link to the ticket. Claim, start, and done stay on the phone and tablet board.

Overdue: a claimed or started ticket that is still open **10 minutes** after due posts once to `SLACK_CHANNEL_ID`, then again every **15 minutes** while it stays overdue. The manual **Slack nudge** button posts immediately and does not wait for the buffer. Constants live in `lib/constants.ts` and can be changed on the owner screen.

Open boards also play a short beep while any ticket is overdue (browsers may wait for a tap before audio starts).

## Seed data

First boot writes three recipes and one ticket each for today (Chicago), due at the recipe's usual time:

| Recipe | Batch | Due | Finished SKU |
| --- | --- | --- | --- |
| Butter croissant | 24 pastries | 10:00 | `CROISSANT` |
| Chocolate chip cookie | 4 dozen | 14:00 | `COOKIE-CCC` |
| Country sourdough | 8 loaves | 06:30 | `LOAF-SOUR` |

The local file catalog includes those SKUs plus raw lines (`FLOUR-AP`, `BUTTER-UNS`, and so on). Butter starts low so the croissant shortage warning is visible. Against the live inventory app, link each recipe line on the Raw tab to a real catalog SKU before Done. If the finished SKU is missing, Done refuses and tells you to add it in inventory first.

## Deploy (test only)

```bash
cp deploy.env.example deploy.env
# fill AUTH_SECRET and the integration secrets
bash scripts/deploy.sh
```

The script exits if you pass another service name, or if `SERVICE` / `CLOUD_RUN_SERVICE` is anything but `sunshine-kitchen-board-test`. Project, region, and bucket are fixed:

- Cloud Run: `sunshine-kitchen-board-test`
- Project: `bakery-444323`
- Region: `us-east1`
- GCS volume: `gs://bakery-444323-sunshine-kitchen-board-test` mounted at `/data`
- Artifact Registry: `us-east1-docker.pkg.dev/bakery-444323/sunshine/sunshine-kitchen-board-test`
- `DATA_DIR=/data`, `TZ=America/Chicago`

After deploy, read the owner password once:

```bash
gcloud storage cat gs://bakery-444323-sunshine-kitchen-board-test/owner-password.txt
```

Give Glenn the service URL plus that email and password, then delete the object. The hash remains in `/data/admin.json`.

The Cloud Run service account needs `storage.objectAdmin` on the kitchen board bucket. If you set `INVENTORY_GCS_BUCKET`, it also needs access to the inventory test bucket. Inventory HTTP mode only needs the admin email and password.

## Smoke checklist

1. Open the board. The heading is Today. Three seeded tasks are a flat list ordered by start time (time, then name). Tap a row for steps, claim, start, and done.
2. The board shows raw on-hand and cooked/finished counts for SKUs on today's tickets. The Raw tab shows those same lines, not the full catalog. With `INVENTORY_TRANSPORT=http` and the inventory admin password, quantities match sunshine-inventory-test. Link any recipe line whose SKU is not in that catalog.
3. Punch in a cook on the time clock (not on this board). Live tab, store Irondale, kitchen filter, shows that person. Confirm this app has no clock-in button.
4. Enter a name, open a row, Claim → Start (acknowledge the butter shortage on croissants if you are on the file catalog) → Done. Enter the amount made. Raw on-hand drops by the recipe batch. The finished SKU and Square Test Cook increase by the amount you entered.
5. Cooked tab: add, remove, and pull a finished catalog SKU. An unknown SKU is refused. Quantities match the inventory app afterward.
6. Square item **Test Cook** (`HRFLTIDM2ZHZNXN4N4EN6WFQ` at `L4CK6YWGT5XQX`) changes by the same cooked amount. No other Square item changes. The app does not recreate the item.
7. On the owner screen, set a claimed ticket to "Due 20 min ago". An open board beeps. Slack posts to the test channel (auto, or the Slack nudge button). A second auto post waits 15 minutes.
8. In Slack, `/recipe` lists today and `/recipe croissant` shows ingredients and steps.
9. Phone width: bottom tabs, one schedule column, rows and Claim / Start / Done at full tap height. Tablet on the counter (portrait and landscape): side rail instead of the bottom bar, larger type, and three equal action buttons inside an open row. Read a start time from arm's length.

Owner login for the activity log and alert settings is the email above plus the generated password.
