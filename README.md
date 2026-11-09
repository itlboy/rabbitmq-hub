# RabbitMQ Hub

A tiny, dependency-free dashboard to watch several RabbitMQ clusters from one page — and empty a queue when you have to.

- **Clusters at a glance** — health dot, version, nodes (RAM / disk / alarms / partitions), queued messages, publish & get rates, connections, shovel status.
- **Queues per cluster** — filter, sort by any column, hide minor queues (e.g. delay queues) with a regex, auto-refresh every 10 s (pause / refresh now).
- **Trends** — 10-minute sparklines for every cluster and queue (from the management API's own samples); a rising backlog turns amber.
- **One queue across clusters** — open a queue to see it on every cluster along the edge → hub path, with its shovel state.
- **Shovels tab** — every shovel with state, node, source/destination (credentials masked) and last error.
- **Read messages** — peek at up to 10 messages (requeued, logged); admins and `peekers` only, can be disabled per cluster.
- **Deep links** — `#cluster` or `#cluster/queue`; the health badge jumps to the first cluster that needs attention.
- **A colour per cluster**, messages with no consumer flagged in red.
- **Node details** — click a node for memory / disk / CPU load explained in plain words (what happens at each limit).
- **Health endpoint** — `GET /api/health` returns `ok | degraded | down` for the whole system (HTTP 200 / 503), ready for any monitor.
- **For AI agents** — a read-only **MCP server** at `/mcp` and a JSON API (`GET /api` lists it), authenticated with a Cloudflare Access service token.
- **Empty a queue** — admins only, the queue name must be typed again, and purge can be disabled per cluster. Every purge is logged and can be posted to a webhook.
- **No database** — users, roles and clusters live in one `config.json`, hot-reloaded when it changes.
- **No runtime dependencies** — `server.js` uses only the Node.js 26 standard library. The UI is Vue 3 + Tailwind CSS 4, built once with Vite into `dist/`.
- **Light / dark / system theme**, remembered per browser.

## How auth works

The hub is designed to sit behind **[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/)** (e.g. Google login):

1. Access authenticates the user and forwards the request with a signed `Cf-Access-Jwt-Assertion` JWT.
2. The hub verifies that JWT itself — signature against your team's JWKS, audience (`aud`), expiry — and reads the email.
   A plain email header is never trusted. No/invalid JWT → `401`.
3. The email is matched against `config.json`: `admins` (view + purge) or `viewers` (view only); `*@domain` matches a whole domain.
   Anyone else → `403`.

Bind the hub to localhost and expose it only through a Cloudflare Tunnel, so the Access check cannot be bypassed.

## Configuration

Copy `config.example.json` to `config.json`:

| Key | Meaning |
|---|---|
| `title` | Page title (optional) |
| `public_origin` | Public URL of the hub; POSTs from another origin are rejected |
| `access.team_domain` | `<team>.cloudflareaccess.com` |
| `access.aud` | AUD tag of the Access application |
| `users.admins` / `users.peekers` / `users.viewers` | Emails or `*@domain`. Admins: view + read messages + purge. Peekers: view + read messages. Viewers: view only |
| `peek_max` | Max messages per read (default 10, max 50) |
| `service_tokens` | `{ "<Access service token client id>": "viewer" \| "peeker" \| "admin" }` — machine access (AI agents, monitors). Unlisted tokens get 403 |
| `clusters[]` | `id`, `name`, `role` (free text), `api` (management API base URL), `expected_nodes`, `allow_purge`, `allow_peek` (default true), `hide_queue_pattern` (regex, optional), `warn_messages` (default 1000) / `warn_threshold` (`{queue: n}`) for row highlighting, `forwards_to` (id of the cluster its shovels feed — draws the flow strip, optional) |

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `RABBITMQ_USER` / `RABBITMQ_PASS` | — | Management API credentials (same user on every cluster). `RABBITMQ_DEFAULT_USER/PASS` also accepted |
| `AUDIT_WEBHOOK_URL` | — | Optional webhook for purge audit (Discord-compatible `content`, Slack-compatible `text`) |
| `PORT` / `BIND` | `8088` / `127.0.0.1` | Listen address |
| `HUB_CONFIG` | `./config.json` | Config path |
| `HUB_TIMEZONE` | `UTC` | Timezone used in audit messages |
| `HUB_DEV_EMAIL` | — | **Local testing only**: skips JWT verification and acts as this email. Never set it in production |

The management user needs the `monitoring` tag to read, plus permissions on the vhost to purge.

## Build and run

```bash
npm install                          # dev tools only: Vite, Vue, Tailwind
npm run build                        # → dist/
cp config.example.json config.json   # then edit
RABBITMQ_USER=hub RABBITMQ_PASS=secret npm start
```

The server only needs `server.js`, `dist/` and `config.json` at runtime — no `node_modules`.

### Docker

Images for `linux/amd64` and `linux/arm64` are built by GitHub Actions and published to `ghcr.io/itlboy/rabbitmq-hub`
— a release tag `vX.Y.Z` publishes `X.Y.Z`, `X.Y` and `latest` (always the newest release); pushes to `main` publish `sha-<short>` only.

Release: `npm version patch` (or `minor`/`major`) then `git push --follow-tags`.

```bash
docker run -d --network host -v $PWD/config.json:/app/config.json:ro \
  -e RABBITMQ_USER=hub -e RABBITMQ_PASS=secret ghcr.io/itlboy/rabbitmq-hub:latest
```
The image binds to `127.0.0.1` by default so that only a local `cloudflared` can reach it. With bridge networking,
set `BIND=0.0.0.0` and publish the port on loopback only (`-p 127.0.0.1:8088:8088`).
Next to `cloudflared` with Docker Compose: [`compose.example.yml`](compose.example.yml).

### Develop

```bash
npm run dev:mock     # UI with example data, no RabbitMQ or Cloudflare needed
# or against real clusters:
HUB_DEV_EMAIL=alice@example.com RABBITMQ_USER=guest RABBITMQ_PASS=guest npm start   # API on :8088
npm run dev          # Vite on :5173, proxies /api to :8088
```
`HUB_DEV_EMAIL` skips JWT verification — local use only.

Layout: `web/src/App.vue` (page), `web/src/components/` (`FlowStrip`, `ClusterRack`, `QueueTable`, `PurgeDialog`, `ThemeToggle`),
`web/src/style.css` (design tokens for both themes, exposed to Tailwind as `bg-panel`, `text-ink-2`, `text-signal`…).

## AI agents (MCP)

`POST /mcp` speaks MCP over Streamable HTTP (JSON responses, stateless). Tools: `system_health`, `list_clusters`, `list_queues`,
`queue_across`, `list_shovels`, `read_messages` (admin/peeker only, logged). **Purging is not exposed over MCP.**

1. In Cloudflare Zero Trust create a service token and add a *Service Auth* policy for it on the hub's Access application.
2. Map its client id in `config.json`: `"service_tokens": { "abc123.access": "viewer" }`.
3. Point the MCP client at `https://<hub>/mcp` with headers `CF-Access-Client-Id` and `CF-Access-Client-Secret`.

```json
{ "mcpServers": { "rabbitmq": { "type": "http", "url": "https://rabbitmq.example.com/mcp",
  "headers": { "CF-Access-Client-Id": "abc123.access", "CF-Access-Client-Secret": "…" } } } }
```

## API

| Method | Path | Who |
|---|---|---|
| `GET` | `/healthz` | anyone (no auth) — process liveness only |
| `GET` | `/api` | viewer — endpoint list |
| `GET` | `/api/health` | viewer — whole-system status, 200 ok / 503 degraded or down |
| `POST` | `/mcp` | viewer (tools), peeker/admin for `read_messages` |
| `GET` | `/api/me` | viewer |
| `GET` | `/api/clusters` | viewer |
| `GET` | `/api/clusters/:id/queues` | viewer |
| `GET` | `/api/clusters/:id/shovels` | viewer |
| `GET` | `/api/queue-across?name=` | viewer |
| `POST` | `/api/clusters/:id/peek` `{vhost, queue, count}` | admin / peeker, cluster `allow_peek` |
| `POST` | `/api/clusters/:id/purge` `{vhost, queue, confirm}` | admin, `confirm` must equal `queue` |

Reading messages uses the management API `get` with `ack_requeue_true`: messages come back to the queue, but they are marked
redelivered, may change order, and on quorum queues each read counts as a delivery attempt (`delivery-limit`).

## License

MIT
