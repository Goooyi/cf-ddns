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
CF_API_TOKEN=YOUR_TOKEN \
CF_ZONE_ID=YOUR_ZONE_ID \
CF_RECORD_NAME=YOUR_RECORD_NAME \
CF_PROXIED=false \
CF_TTL=300 \
CF_INTERVAL=300 \
nohup python3 cf_ddns.py > ~/cf-ddns.log 2>&1 &
```
- `CF_API_TOKEN` (required) DNS edit token.
- `CF_ZONE_ID` (required) Zone ID of the domain (see Cloudflare dashboard).
- `CF_RECORD_NAME` (required) FQDN to update.
- `CF_PROXIED` (optional) `true`/`false` (default `false`).
- `CF_TTL` (optional) TTL in seconds (default `300`).
- `CF_INTERVAL` (optional) seconds between checks (default `300`).

### How often updates run
- Every `CF_INTERVAL` seconds (default 5 minutes).
- The script only calls Cloudflare when the detected IP or proxied setting changes.

### Logs
- With the `nohup` example above: `tail -f ~/cf-ddns.log`
- You’ll see messages like “Detected public IP” and “Updated …”.

### Stopping the script
- If launched via nohup: `pkill -f cf_ddns.py`
- If running in a `tmux`/`screen`/`systemd` session, stop it there.

### Notes
- Uses `cip.cc` (https with http fallback) and extracts the first IPv4 from the response.
- If the DNS record does not exist, the script logs a warning and does not auto-create it—create the A record once in Cloudflare before running.***
