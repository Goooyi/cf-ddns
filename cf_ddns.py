#!/usr/bin/env python3
"""
Cloudflare DDNS updater using cip.cc for public IPv4 detection.
Run on your server (e.g., via systemd, nohup, or tmux).

Config via environment variables:
  CF_API_TOKEN   (required) - Cloudflare API token with DNS edit on the zone
  CF_ZONE_ID     (required) - Cloudflare zone ID
  CF_RECORD_NAME (required) - FQDN to update (e.g., home.example.com)
  CF_PROXIED     (optional) - true/false; default false
  CF_TTL         (optional) - TTL in seconds; default 300
  CF_INTERVAL    (optional) - Loop interval in seconds; default 300

Example:
  CF_API_TOKEN=xxx CF_ZONE_ID=yyy CF_RECORD_NAME=home.example.com \
  CF_PROXIED=false CF_INTERVAL=300 python3 cf_ddns.py
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


CIP_URLS = [
    ("https://cip.cc", {"User-Agent": "curl/8.0 CF-DDNS"}),
    ("http://cip.cc", {"User-Agent": "curl/8.0 CF-DDNS"}),  # fallback
]
IP_REGEX = re.compile(
    r"\b(?:(?:2(?:5[0-5]|[0-4][0-9])|1?[0-9]{1,2})\.){3}(?:2(?:5[0-5]|[0-4][0-9])|1?[0-9]{1,2})\b"
)


def log(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def env_bool(name, default=False):
    val = os.getenv(name)
    if val is None:
        return default
    return str(val).lower() in ("1", "true", "yes", "on")


def get_env_config():
    cfg = {
        "api_token": os.getenv("CF_API_TOKEN", "").strip(),
        "zone_id": os.getenv("CF_ZONE_ID", "").strip(),
        "record_name": os.getenv("CF_RECORD_NAME", "").strip(),
        "proxied": env_bool("CF_PROXIED", False),
        "ttl": int(os.getenv("CF_TTL", "300")),
        "interval": int(os.getenv("CF_INTERVAL", "300")),
    }
    missing = [k for k in ("api_token", "zone_id", "record_name") if not cfg[k]]
    if missing:
        raise SystemExit(f"Missing required env vars: {', '.join(missing)}")
    return cfg


def http_request(method, url, headers=None, data=None):
    req = urllib.request.Request(url, method=method, headers=headers or {})
    if data is not None:
        if isinstance(data, str):
            data = data.encode()
        req.data = data
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read()
            status = resp.status
            return status, body.decode(errors="ignore")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="ignore") if hasattr(e, "read") else ""
        raise RuntimeError(f"HTTP {e.code} {url}: {body}") from e
    except Exception as e:
        raise RuntimeError(f"Request failed {url}: {e}") from e


def fetch_public_ip():
    for url, headers in CIP_URLS:
        try:
            status, body = http_request("GET", url, headers=headers)
            ip = parse_ip(body)
            if ip:
                return ip
            log(f"cip.cc returned no IP (status {status}); body={body!r}")
        except Exception as e:
            log(f"cip.cc lookup failed: {e}")
    raise RuntimeError("Could not determine public IP from cip.cc")


def parse_ip(text):
    if not text:
        return ""
    m = IP_REGEX.search(text)
    return m.group(0) if m else ""


def get_dns_record(cfg):
    base = f"https://api.cloudflare.com/client/v4/zones/{cfg['zone_id']}/dns_records"
    params = urllib.parse.urlencode({"type": "A", "name": cfg["record_name"]})
    url = f"{base}?{params}"
    headers = {
        "Authorization": f"Bearer {cfg['api_token']}",
        "Content-Type": "application/json",
    }
    status, body = http_request("GET", url, headers=headers)
    data = json.loads(body)
    if not data.get("success"):
        raise RuntimeError(f"Cloudflare get record failed: {data}")
    results = data.get("result") or []
    return results[0] if results else None


def update_dns_record(cfg, record_id, ip):
    url = f"https://api.cloudflare.com/client/v4/zones/{cfg['zone_id']}/dns_records/{record_id}"
    headers = {
        "Authorization": f"Bearer {cfg['api_token']}",
        "Content-Type": "application/json",
    }
    payload = json.dumps(
        {
            "type": "A",
            "name": cfg["record_name"],
            "content": ip,
            "proxied": cfg["proxied"],
            "ttl": cfg["ttl"],
        }
    )
    status, body = http_request("PUT", url, headers=headers, data=payload)
    data = json.loads(body)
    if not data.get("success"):
        raise RuntimeError(f"Cloudflare update failed: {data}")
    return data.get("result")


def main_loop():
    cfg = get_env_config()
    log(
        f"Starting CF DDNS for {cfg['record_name']} (zone {cfg['zone_id']}), "
        f"proxied={cfg['proxied']}, ttl={cfg['ttl']}, interval={cfg['interval']}s"
    )
    last_ip = None
    while True:
        try:
            current_ip = fetch_public_ip()
            if current_ip != last_ip:
                log(f"Detected public IP: {current_ip}")
            record = get_dns_record(cfg)
            if not record:
                log(f"Record {cfg['record_name']} not found in zone; will not create automatically.")
            else:
                if record.get("content") == current_ip and record.get("proxied") == cfg["proxied"]:
                    log(f"No change needed (IP {current_ip}, proxied={cfg['proxied']})")
                else:
                    update_dns_record(cfg, record["id"], current_ip)
                    log(f"Updated {cfg['record_name']} to {current_ip} (proxied={cfg['proxied']})")
            last_ip = current_ip
        except Exception as e:
            log(f"Error: {e}")
        time.sleep(cfg["interval"])


if __name__ == "__main__":
    try:
        main_loop()
    except KeyboardInterrupt:
        log("Exiting on keyboard interrupt")
        sys.exit(0)
