# Deploy runbook — value-refresh batch on a static-IP box

Reproduce the BrickLink value-refresh batch on a fresh **static-IPv4** host (a DigitalOcean droplet in
the live setup). The batch ([`scripts/refresh-values.mjs`](../scripts/refresh-values.mjs)) reads the live
owned-set list from Upstash, pulls BrickLink 6-mo sold data, and writes the `value:SET:{n}` /
`history:SET:{n}` cache the app reads. It runs **weekly** via the systemd units in
[`deploy/`](../deploy/).

**Why a dedicated box:** the BrickLink Store API authorizes calls by a **fixed IP** bound to an Access
Token. A static-egress host is the supported way to give the batch a stable, whitelisted source IP.

---

## 0. Prerequisites
- A host with a **static public IPv4** and root/sudo.
- The Upstash REST creds (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) — same store the app + sync use.
- BrickLink Store API **consumer key/secret** (account-level, reused from home).

---

## 1. BrickLink: a NEW IP-bound Access Token for this box ⚠️

BrickLink tokens are **bound to a source IP**, and an account may hold **multiple** tokens. So **add a
new token for the box's IP — do NOT edit/replace the home token** (that would break local runs).

1. BrickLink → **My Account → API → Access Tokens → Register/Add**.
2. **IP address:** the box's static IPv4 (see §6 to confirm it). **IP mask:** `255.255.255.255` (exact
   single-host match — not a range).
3. Save. You now get a **token + token-secret for the droplet** — these are the `BL_TOKEN` /
   `BL_TOKEN_SECRET` that go in the box's `.env.local` (§4). The consumer key/secret are shared with home.

> **IPv6 red herring.** BrickLink whitelisting is **IPv4-only**. If calls 401/403 with a correct-looking
> token, the box may be egressing over IPv6. Confirm the **IPv4** egress matches the whitelisted IP:
> ```
> curl -4 https://api.ipify.org   # must equal the IP you whitelisted in step 2
> curl -6 https://api.ipify.org   # informational only — BL ignores this
> ```
> If `-4` differs from the whitelist (or the box has no stable IPv4 egress), fix that before anything else.

---

## 2. Node (NodeSource)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # v22.x ; installs to /usr/bin/node (matches ExecStart in the .service)
```

## 3. Clone into a hyphen-free path ⚠️

The GitHub repo name **starts with a hyphen** (`-lego-collection-tracker`), which many tools parse as a
flag. Clone into a clean directory and work from there (this is the `WorkingDirectory` in the unit):

```bash
sudo useradd -r -m -d /opt/brickledger -s /usr/sbin/nologin brickledger   # dedicated non-login user
sudo -u brickledger git clone https://github.com/mahalobrick/-lego-collection-tracker.git /opt/brickledger/app
cd /opt/brickledger/app
sudo -u brickledger npm ci --omit=dev   # only runtime deps (oauth-1.0a, @upstash/redis); skips devDeps
```

## 4. Secrets — `.env.local` (uncommitted, chmod 600)

The script reads its six vars from `./.env.local` at the repo root (via `loadEnvKey`) — it is **gitignored
and never committed**. Create it with the **droplet's** BL token (not home's):

```bash
sudo -u brickledger tee /opt/brickledger/app/.env.local >/dev/null <<'EOF'
BL_CONSUMER_KEY="…"
BL_CONSUMER_SECRET="…"
BL_TOKEN="…"          # the DROPLET token from §1 — NOT the home token
BL_TOKEN_SECRET="…"   # the DROPLET token-secret from §1
KV_REST_API_URL="https://…upstash.io"
KV_REST_API_TOKEN="…"
EOF
sudo chmod 600 /opt/brickledger/app/.env.local
sudo chown brickledger:brickledger /opt/brickledger/app/.env.local
```

The six vars are documented in [`.env.example`](../.env.example) (BL_* + KV_REST_API_*).

## 5. Install + enable the timer

```bash
sudo cp deploy/brickledger-refresh.service deploy/brickledger-refresh.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now brickledger-refresh.timer
```

Verify the schedule, then do a real test run and watch the log:

```bash
systemctl list-timers brickledger-refresh.timer   # shows NEXT (Sun 03:00) + LAST
sudo systemctl start brickledger-refresh.service   # one-off run now (don't wait for Sunday)
journalctl -u brickledger-refresh.service -f       # follow: "Source: Upstash …", per-set lines, RUN SUMMARY
```

A healthy run ends with a `RUN SUMMARY` (sets written, basis counts) and a sample read-back. If it 401/403s
on BrickLink, recheck §1 + the §6 IPv4 confirmation.

## 6. Confirm the box's whitelisted IP

```bash
curl -4 https://api.ipify.org   # the IPv4 the batch egresses from — must match the BL whitelist (§1)
```

---

## Schedule & operations
- **Cadence:** `OnCalendar=Sun *-*-* 03:00:00`, `Persistent=true` (catches up after downtime). Weekly is safe —
  the app's client value cache TTL is 24h, so it tolerates week-old server data.
- **Change cadence:** edit `deploy/brickledger-refresh.timer`, re-copy to `/etc/systemd/system/`,
  `daemon-reload`, `restart` the timer.
- **Run-time guard:** `TimeoutStartSec=1800` in the `.service` — a full run is ~6-10 min, well under the
  default 90s oneshot timeout that would otherwise kill it.
- **Logs:** `journalctl -u brickledger-refresh.service` (per run). No secrets are logged.
- **Set list is live:** the batch sources owned sets from Upstash (`brickledger:user:*`), so newly-synced
  sets are valued on the next run with no redeploy. CMF/promo sets are deferred to Phase 2 (see
  [`docs/value-source-decision.md`](value-source-decision.md) §5).

## Updating the box
```bash
cd /opt/brickledger/app && sudo -u brickledger git pull && sudo -u brickledger npm ci --omit=dev
```
The timer keeps the new code on the next schedule; no unit changes needed unless `deploy/*` changed (then
re-copy + `daemon-reload`).
