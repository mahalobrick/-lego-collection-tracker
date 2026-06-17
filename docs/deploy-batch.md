# Deploy runbook — value-refresh batch on a static-IP box

Reproduce the BrickLink value-refresh batch on a fresh **static-IPv4** host (a DigitalOcean droplet in
the live setup). The batch ([`scripts/refresh-values.mjs`](../scripts/refresh-values.mjs)) reads the live
owned-set list from Upstash, pulls BrickLink 6-mo sold data, and writes the `value:SET:{n}` /
`history:SET:{n}` cache the app reads. It runs **weekly** via the systemd units in
[`deploy/`](../deploy/).

**Why a dedicated box:** the BrickLink Store API authorizes calls by a **fixed IP** bound to an Access
Token. A static-egress host is the supported way to give the batch a stable, whitelisted source IP.

> **Live deployment (today):** DigitalOcean droplet `<VPS_IP>`, Ubuntu, running **as root** from
> `/root/brickledger`, weekly **Sun 03:00 UTC**. Running under a dedicated non-login user (e.g.
> `/opt/brickledger/app`) is noted as **optional future hardening** — not what the box runs now.
>
> **Security note (M1, Jun-17 audit):** the literal IP was previously committed in this file, so the box
> must be treated as **internet-known** — host hardening (SSH, firewall, non-root run) is tracked
> separately and is *not* solved by this redaction. Keep the real IP out of this doc; use `<VPS_IP>`.

---

## 0. Provision the box
- A host with a **static public IPv4** and root. Note its public IPv4 (you'll whitelist it in §1, and
  the live box is `<VPS_IP>`).
- The Upstash REST creds (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) — same store the app + sync use.
- BrickLink Store API **consumer key/secret** (account-level, reused from home).

---

## 1. BrickLink: a NEW IP-bound Access Token for this box ⚠️

BrickLink tokens are **bound to a source IP**, and an account may hold **multiple** tokens. So **add a
new token for the box's IP — do NOT edit/replace the home token** (that would break local runs).

1. BrickLink → **My Account → API → Access Tokens → Register/Add**.
2. **IP address:** the box's static IPv4 (confirm it in §5). **IP mask:** `255.255.255.255` (exact
   single-host match — not a range).
3. Save. You now get a **token + token-secret for the box** — these are the `BL_TOKEN` /
   `BL_TOKEN_SECRET` that go in the box's `.env.local` (§4). The consumer key/secret are shared with home.

---

## 2. Node (NodeSource)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node -v   # v22.x ; installs to /usr/bin/node (matches ExecStart in the .service)
```

## 3. Clone into a hyphen-free path ⚠️

The GitHub repo name **starts with a hyphen** (`-lego-collection-tracker`), which `cd` and many tools
parse as a flag. Clone into an explicit, hyphen-free directory name and work from there (this is the
`WorkingDirectory` in the unit):

```bash
cd /root
git clone https://github.com/mahalobrick/-lego-collection-tracker.git brickledger
cd /root/brickledger
npm ci --omit=dev   # only runtime deps (oauth-1.0a, @upstash/redis); skips devDeps
```

## 4. Secrets — `.env.local` (uncommitted, chmod 600)

The script reads its six vars from `./.env.local` via `loadEnvKey`, which resolves the path **relative to
the current working directory** — which is exactly why the `.service` pins `WorkingDirectory=/root/brickledger`.
The file is **gitignored and never committed**. Create it with the **box's** BL token (not home's):

```bash
tee /root/brickledger/.env.local >/dev/null <<'EOF'
BL_CONSUMER_KEY="…"
BL_CONSUMER_SECRET="…"
BL_TOKEN="…"          # the BOX token from §1 — NOT the home token
BL_TOKEN_SECRET="…"   # the BOX token-secret from §1
KV_REST_API_URL="https://…upstash.io"
KV_REST_API_TOKEN="…"
EOF
chmod 600 /root/brickledger/.env.local
```

The six vars are documented in [`.env.example`](../.env.example) (BL_* + KV_REST_API_*).

> **⚠️ Paste each token value as one unbroken line — no trailing space, no wrap.** This is the actual
> auth failure we hit (it was **not** IPv6): a token pasted with a line-wrap or stray trailing space is
> silently malformed, so OAuth signing fails and **every** BrickLink call 401/403s with a token that
> *looks* correct. If auth fails, re-paste the token and token-secret first.

## 5. Pre-flight + manual proof run

Confirm the box egresses from the whitelisted IPv4, then prove the batch end-to-end **by hand** before
handing it to the timer:

```bash
curl -4 -s https://api.ipify.org   # must equal the box IP you whitelisted in §1 (your <VPS_IP>)
cd /root/brickledger && node scripts/refresh-values.mjs
```

A healthy run ends with a `RUN SUMMARY` — expect **`461 written, 0 errors`** (sets processed = value:SET
written, BL errors = 0) plus basis counts and a sample read-back. If it 401/403s on BrickLink, recheck the
§4 token-paste caution, then the IPv4 below.

> **IPv6 red herring.** BrickLink whitelisting is **IPv4-only**. If calls fail *after* the token paste is
> confirmed clean, check the box isn't egressing over IPv6:
> ```
> curl -4 -s https://api.ipify.org   # must equal the whitelisted IP
> curl -6 -s https://api.ipify.org   # informational only — BL ignores this
> ```
> If `-4` differs from the whitelist (or the box has no stable IPv4 egress), fix that. But in practice the
> real culprit was the wrapped token paste (§4), not IPv6.

## 6. Install + enable the weekly timer

```bash
cp deploy/brickledger-refresh.service deploy/brickledger-refresh.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now brickledger-refresh.timer
```

Verify the schedule, then do a one-off service run and watch the log:

```bash
systemctl list-timers brickledger-refresh.timer   # shows NEXT (Sun 03:00) + LAST
systemctl start brickledger-refresh.service        # one-off run now (don't wait for Sunday)
journalctl -u brickledger-refresh.service -f       # follow: "Source: Upstash …", per-set lines, RUN SUMMARY
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
cd /root/brickledger && git pull && npm ci --omit=dev
```
The timer keeps the new code on the next schedule; no unit changes needed unless `deploy/*` changed (then
re-copy + `daemon-reload`).
