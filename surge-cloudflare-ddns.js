// Surge Script: Cloudflare DDNS updater
// Usage: import this file into Surge and schedule via a cron task.
// Required: set CONFIG.apiToken, CONFIG.zoneId, CONFIG.recordName below (or via persistent store keys).
// Optional: set the `cf_ddns_*` keys once via the Surge script console to avoid hardcoding secrets.

'use strict';

const CONFIG = {
  apiToken: $persistentStore.read('cf_ddns_api_token') || '', // Cloudflare API token with DNS edit
  zoneId: $persistentStore.read('cf_ddns_zone_id') || '',     // Cloudflare zone ID
  recordName: $persistentStore.read('cf_ddns_record_name') || '', // FQDN to update, e.g. home.example.com
  proxied:
    readBoolean('cf_ddns_proxied') ??
    false, // set to true to enable Cloudflare proxy on the record
  ttl: Number($persistentStore.read('cf_ddns_ttl')) || 300, // seconds; 1 = auto, min 120 for most plans
  ipLookupTargets: [
    // Use cip.cc only; keep http/https variants with a curl-ish UA for compatibility.
    { url: 'https://cip.cc', headers: { 'User-Agent': 'curl/8.0 Surge-DDNS' } },
    { url: 'http://cip.cc', headers: { 'User-Agent': 'curl/8.0 Surge-DDNS' } } // fallback
  ],
  notifyOnChange:
    readBoolean('cf_ddns_notify_on_change') ??
    true
};

(function hydrateFromArgument() {
  const args = parseArgument($argument);
  if (!args) return;
  CONFIG.apiToken = pick(args, 'apiToken', 'CF_API_TOKEN') || CONFIG.apiToken;
  CONFIG.zoneId = pick(args, 'zoneId', 'CF_ZONE_ID') || CONFIG.zoneId;
  CONFIG.recordName = pick(args, 'recordName', 'CF_RECORD_NAME') || CONFIG.recordName;
  CONFIG.notifyOnChange =
    parseBoolean(pick(args, 'notifyOnChange', 'notify', 'CF_NOTIFY_ON_CHANGE')) ??
    CONFIG.notifyOnChange;
  CONFIG.proxied =
    pick(args, 'proxied', 'CF_PROXIED') !== undefined
      ? parseBoolean(pick(args, 'proxied', 'CF_PROXIED')) === true
      : CONFIG.proxied;
  CONFIG.ttl = pick(args, 'ttl', 'CF_TTL') ? Number(pick(args, 'ttl', 'CF_TTL')) : CONFIG.ttl;
})();

(async () => {
  try {
    validateConfig();
    const currentIP = await getPublicIP();
    const record = await getDNSRecord();

    if (!record) {
      throw new Error(`DNS record not found for ${CONFIG.recordName}`);
    }

    if (record.content === currentIP && record.proxied === CONFIG.proxied) {
      finish(`IP unchanged (${currentIP}); proxied=${record.proxied}`);
      return;
    }

    await updateDNSRecord(record.id, currentIP);
    finish(`Updated ${CONFIG.recordName} to ${currentIP}; proxied=${CONFIG.proxied}`, false, CONFIG.notifyOnChange);
  } catch (err) {
    finish(`Cloudflare DDNS error: ${err.message}`, true, true);
  }
})();

function validateConfig() {
  if (!CONFIG.apiToken || !CONFIG.zoneId || !CONFIG.recordName) {
    throw new Error('Missing apiToken/zoneId/recordName; set via CONFIG or persistent store.');
  }
}

function readBoolean(key) {
  const val = $persistentStore.read(key);
  if (val === null || val === undefined) return null;
  return val === 'true' || val === true;
}

function httpRequest(opts) {
  return new Promise((resolve, reject) => {
    $httpClient[opts.method.toLowerCase()](opts, (error, response, body) => {
      if (error) return reject(error);
      const status = response?.status || response?.statusCode;
      if (status >= 400) {
        return reject(
          new Error(`HTTP ${status} for ${opts.method} ${opts.url}: ${body || 'no body'}`)
        );
      }
      resolve({ response, body });
    });
  });
}

async function getPublicIP() {
  for (const target of CONFIG.ipLookupTargets) {
    const url = typeof target === 'string' ? target : target.url;
    const headers = typeof target === 'string' ? {} : target.headers || {};
    if (!url) continue;
    try {
      const { body } = await httpRequest({ url, method: 'GET', headers });
      const ip = parseIP(body);
      if (ip) return ip;
    } catch (_) {
      // try next endpoint
    }
  }
  throw new Error('Could not determine public IP from any lookup endpoint.');
}

function parseIP(body) {
  if (typeof body !== 'string') {
    try {
      body = JSON.stringify(body);
    } catch (_) {
      return '';
    }
  }
  const jsonMatch = body.trim().startsWith('{');
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(body);
      return (
        parsed.ip ||
        parsed.address ||
        parsed.IPv4 ||
        parsed.query ||
        parsed.remote_addr ||
        ''
      ).toString().trim();
    } catch (_) {
      // fall through
    }
  }
  const ipMatch = body.match(
    /\b(?:(?:2(?:5[0-5]|[0-4][0-9])|1?[0-9]{1,2})\.){3}(?:2(?:5[0-5]|[0-4][0-9])|1?[0-9]{1,2})\b/
  );
  return ipMatch ? ipMatch[0] : '';
}

async function getDNSRecord() {
  const url = `https://api.cloudflare.com/client/v4/zones/${CONFIG.zoneId}/dns_records?type=A&name=${encodeURIComponent(
    CONFIG.recordName
  )}`;
  const headers = {
    Authorization: `Bearer ${CONFIG.apiToken}`,
    'Content-Type': 'application/json'
  };
  const { body } = await httpRequest({ url, method: 'GET', headers });
  const data = safeJSON(body);
  if (!data?.success) throw new Error(JSON.stringify(data?.errors || data));
  return data.result?.[0] || null;
}

async function updateDNSRecord(recordId, ip) {
  const url = `https://api.cloudflare.com/client/v4/zones/${CONFIG.zoneId}/dns_records/${recordId}`;
  const headers = {
    Authorization: `Bearer ${CONFIG.apiToken}`,
    'Content-Type': 'application/json'
  };
  const payload = {
    type: 'A',
    name: CONFIG.recordName,
    content: ip,
    proxied: CONFIG.proxied,
    ttl: CONFIG.ttl
  };
  const { body } = await httpRequest({
    url,
    method: 'PUT',
    headers,
    body: JSON.stringify(payload)
  });
  const data = safeJSON(body);
  if (!data?.success) throw new Error(JSON.stringify(data?.errors || data));
  return data.result;
}

function safeJSON(str) {
  if (typeof str !== 'string') return str;
  try {
    return JSON.parse(str);
  } catch (_) {
    return null;
  }
}

function finish(msg, isError = false, notify = false) {
  const title = isError ? 'Cloudflare DDNS: Error' : 'Cloudflare DDNS: OK';
  if (notify) {
    $notification.post(title, '', msg);
  }
  $done({ msg, error: isError ? msg : undefined });
}

function parseArgument(arg) {
  if (!arg || typeof arg !== 'string') return null;
  const out = {};
  const pairs = arg.split(/[,&;\n]/).map((s) => s.trim()).filter(Boolean);
  for (const pair of pairs) {
    const i = pair.indexOf('=');
    const k = i >= 0 ? pair.slice(0, i) : pair;
    const v = i >= 0 ? pair.slice(i + 1) : '';
    if (!k) continue;
    out[decodeArg(k.trim())] = decodeArg(v.trim());
  }
  return out;
}

function pick(obj, ...keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== '') return obj[key];
  }
  return undefined;
}

function parseBoolean(val) {
  if (val === undefined || val === null || val === '') return null;
  return val === true || ['1', 'true', 'yes', 'on'].includes(String(val).toLowerCase());
}

function decodeArg(val) {
  try {
    return decodeURIComponent(String(val).replace(/\+/g, ' '));
  } catch (_) {
    return val;
  }
}
