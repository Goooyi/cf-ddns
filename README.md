## Cloudflare DDNS (cip.cc + Python)

### What this does
- Polls `cip.cc` to detect your server's public IPv4.
- Updates a Cloudflare A record when the IP changes (or when proxied flag differs).
- Runs as a simple Python loop; you can background it with `nohup`, `tmux`, or `systemd`.

### Requirements
- Python 3 on the server.
- A Cloudflare API token with DNS edit permissions for the target zone.

### Configure and launch
From the repo directory:
```bash
cp .env.example .env
$EDITOR .env
set -a
. ./.env
set +a
nohup python3 cf_ddns.py >/dev/null 2>&1 &
```
- `CF_API_TOKEN` (required) DNS edit token.
- `CF_ZONE_ID` (required) Zone ID of the domain (see Cloudflare dashboard).
- `CF_RECORD_NAME` (required) FQDN to update.
- `CF_PROXIED` (optional) `true`/`false` (default `false`).
- `CF_TTL` (optional) TTL in seconds (default `300`).
- `CF_INTERVAL` (optional) seconds between checks (default `300`).
- `CF_LOG_FILE` (optional) rotating log file path. If set, logs rotate at 1 MB with 3 backups.

### Where to get the values
- `CF_API_TOKEN`: Cloudflare dashboard → My Profile → API Tokens → Create Token → use the “Edit zone DNS” template, scoped to this zone.
- `CF_ZONE_ID`: Cloudflare dashboard → Account home → your account Overview → API section → Zone ID.
- `CF_RECORD_NAME`: the DNS name to keep updated, such as `home.example.com`. Create this A record once in Cloudflare DNS before running the script.

### How often updates run
- Every `CF_INTERVAL` seconds (default 5 minutes).
- The script only updates Cloudflare when the detected IP or proxied setting changes.

### Logs
- With the `nohup` example above: `tail -f ./cf-ddns.log`
- You’ll see messages like “Detected public IP” and “Updated …”.

### Surge module
Use this instead of the Python loop on Surge Mac:

1. Add `cloudflare-ddns.sgmodule` to Surge, or install it from:
   `https://raw.githubusercontent.com/Goooyi/cf-ddns/main/cloudflare-ddns.sgmodule`
2. Enable the module.
3. Right-click the module, choose “Edit Argument”, and fill:
   - `apiToken`: Cloudflare API token with Zone DNS Edit permission.
   - `zoneId`: Cloudflare Zone ID.
   - `recordName`: full A record name, such as `home.example.com`.
   - `proxied`: `true` or `false`.
   - `ttl`: `300` or `1` for auto.
   - `notifyOnChange`: `true` to notify only on DNS update or error.

Surge does not read `.env`; the “Edit Argument” dialog is the Surge config for this module. URL install requires this GitHub repo to be public or otherwise reachable by Surge.

The module runs `surge-cloudflare-ddns.js` every 5 minutes and forces `cip.cc` plus `api.cloudflare.com` through `DIRECT`, so the IP check sees this network instead of a proxy exit IP.

### Stopping the script
- If launched via nohup: `pkill -f cf_ddns.py`
- If running in a `tmux`/`screen`/`systemd` session, stop it there.

### Notes
- Uses `cip.cc` (https with http fallback) and extracts the first IPv4 from the response.
- If the DNS record does not exist, the script logs a warning and does not auto-create it; create the A record once in Cloudflare before running.
