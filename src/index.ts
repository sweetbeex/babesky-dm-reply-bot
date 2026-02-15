import { Env, BotConfig } from './types';
import { BlueskyDmClient } from './bluesky-dm';

const CONFIG_KEY = 'config';
const REPLIED_PREFIX = 'replied:';
const DEFAULT_WELCOME = "Hi! Thanks for reaching out. How can I help you today?";
const MAX_DELAY_SECONDS = 300;

function clampDelay(val: number): number {
  return Math.min(MAX_DELAY_SECONDS, Math.max(0, Math.round(Number(val)) || 0));
}

async function getConfig(kv: KVNamespace): Promise<BotConfig> {
  const raw = await kv.get(CONFIG_KEY);
  if (!raw) {
    return {
      welcomeMessage: DEFAULT_WELCOME,
      enabled: false,
      messageDelaySeconds: 0,
      setupComplete: false,
    };
  }
  const parsed = JSON.parse(raw) as BotConfig;
  if (parsed.messageDelaySeconds === undefined) parsed.messageDelaySeconds = 0;
  return parsed;
}

async function saveConfig(kv: KVNamespace, config: BotConfig): Promise<void> {
  await kv.put(CONFIG_KEY, JSON.stringify(config));
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const computed = await hashPassword(password);
  return computed === hash;
}

const SESSION_COOKIE_NAME = 'admin_session';
const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

function getSessionFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map((p) => p.trim());
  for (const part of parts) {
    const [name, value] = part.split('=').map((s) => s.trim());
    if (name === SESSION_COOKIE_NAME && value) return value;
  }
  return null;
}

async function createSession(secret: string): Promise<string> {
  const payload = { exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC };
  const data = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${btoa(data)}.${sigB64}`;
}

async function verifySession(token: string, secret: string): Promise<boolean> {
  try {
    const [dataB64, sigB64] = token.split('.');
    if (!dataB64 || !sigB64) return false;
    const data = atob(dataB64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(data) as { exp: number };
    if (payload.exp < Math.floor(Date.now() / 1000)) return false;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const sig = Uint8Array.from(
      atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0)
    );
    return await crypto.subtle.verify('HMAC', key, sig, encoder.encode(data));
  } catch {
    return false;
  }
}

function sessionCookie(token: string, baseUrl: string): string {
  const url = new URL(baseUrl);
  const secure = url.protocol === 'https:' ? 'Secure; ' : '';
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=${SESSION_TTL_SEC}`;
}

function clearSessionCookie(_baseUrl: string): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Cron handler: poll Bluesky DMs and reply to first-time messagers.
 */
async function runDmReplyCycle(env: Env): Promise<void> {
  const config = await getConfig(env.BOT_CONFIG);
  if (!config.enabled) return;

  const handle = env.BSKY_HANDLE;
  const appPassword = env.BSKY_APP_PASSWORD;
  const serviceUrl = env.BSKY_SERVICE_URL || 'https://bsky.social';

  if (!handle || !appPassword) {
    console.error('BSKY_HANDLE or BSKY_APP_PASSWORD not set');
    return;
  }

  const client = new BlueskyDmClient(handle, appPassword, serviceUrl);
  await client.login(appPassword);

  const welcomeMsg = config.welcomeMessage?.trim() || DEFAULT_WELCOME;
  const delay = Math.min(MAX_DELAY_SECONDS, Math.max(0, config.messageDelaySeconds ?? 0));

  let cursor: string | undefined;
  let repliedCount = 0;

  do {
    const { convos, cursor: nextCursor } = await client.listConvos(50, cursor);
    cursor = nextCursor;

    for (const convo of convos) {
      const otherDid = client.getOtherParticipantDid(convo);
      if (!otherDid) continue;
      if (!client.isLastMessageFromOther(convo)) continue; // Last message is from us, skip

      const repliedKey = `${REPLIED_PREFIX}${otherDid}`;
      const alreadyReplied = await env.BOT_CONFIG.get(repliedKey);
      if (alreadyReplied) continue;

      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay * 1000));
      }

      const sent = await client.sendMessage(convo.id, welcomeMsg);
      if (sent) {
        await env.BOT_CONFIG.put(repliedKey, '1', { expirationTtl: 60 * 60 * 24 * 365 });
        repliedCount++;
      }
    }
  } while (cursor);

  if (repliedCount > 0) {
    console.log(`Replied to ${repliedCount} new DM(s)`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const baseUrl = env.WEBHOOK_BASE_URL || `https://${new URL(request.url).host}`;

    if (url.pathname === '/health' || url.pathname === '/') {
      return jsonResponse({ status: 'ok' });
    }

    // Admin
    if (url.pathname.startsWith('/admin')) {
      return handleAdmin(request, env, url, baseUrl);
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runDmReplyCycle(env);
  },
};

async function handleAdmin(
  request: Request,
  env: Env,
  url: URL,
  baseUrl: string
): Promise<Response> {
  const path = url.pathname.slice('/admin'.length) || '/';
  const kv = env.BOT_CONFIG;
  const config = await getConfig(kv);

  if (!config.setupComplete && path !== '/setup' && !path.startsWith('/api/')) {
    return new Response(getSetupWizardHtml(baseUrl), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (path === '/api/setup' && request.method === 'POST') {
    const body = (await request.json()) as {
      adminPassword?: string;
      welcomeMessage?: string;
      enabled?: boolean;
      messageDelaySeconds?: number;
    };
    const password = (body.adminPassword || '').trim();
    if (password.length < 8) {
      return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);
    }
    const welcomeMessage = (body.welcomeMessage || DEFAULT_WELCOME).trim() || DEFAULT_WELCOME;
    const messageDelaySeconds = clampDelay(body.messageDelaySeconds ?? 0);
    const hash = await hashPassword(password);
    const newConfig: BotConfig = {
      ...config,
      welcomeMessage,
      enabled: body.enabled ?? false,
      messageDelaySeconds,
      adminPasswordHash: hash,
      setupComplete: true,
    };
    await saveConfig(kv, newConfig);
    return jsonResponse({ success: true });
  }

  if (!config.setupComplete) {
    return new Response(getSetupWizardHtml(baseUrl), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const secret = env.ADMIN_SESSION_SECRET;
  if (!secret) {
    return jsonResponse(
      { error: 'Admin not configured: ADMIN_SESSION_SECRET missing.' },
      503
    );
  }

  const sessionToken = getSessionFromRequest(request);
  const isAuthenticated = sessionToken ? await verifySession(sessionToken, secret) : false;

  if (path === '/login' && request.method === 'POST') {
    const body = (await request.json()) as { password?: string };
    const password = body.password || '';
    const hash = config.adminPasswordHash;
    if (!hash) {
      return jsonResponse({ error: 'No admin password configured' }, 401);
    }
    const valid = await verifyPassword(password, hash);
    if (!valid) {
      return jsonResponse({ error: 'Invalid password' }, 401);
    }
    const token = await createSession(secret);
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/admin',
        'Set-Cookie': sessionCookie(token, baseUrl),
      },
    });
  }

  if (path === '/logout' && request.method === 'GET') {
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/admin',
        'Set-Cookie': clearSessionCookie(baseUrl),
      },
    });
  }

  if (path === '/api/config') {
    if (!isAuthenticated) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    if (request.method === 'GET') {
      return jsonResponse({
        welcomeMessage: config.welcomeMessage,
        enabled: config.enabled,
        messageDelaySeconds: config.messageDelaySeconds ?? 0,
      });
    }
    if (request.method === 'POST') {
      const body = (await request.json()) as {
        welcomeMessage?: string;
        enabled?: boolean;
        messageDelaySeconds?: number;
      };
      const newConfig: BotConfig = {
        ...config,
        welcomeMessage: (body.welcomeMessage ?? config.welcomeMessage).trim() || DEFAULT_WELCOME,
        enabled: body.enabled ?? config.enabled,
        messageDelaySeconds: body.messageDelaySeconds !== undefined ? clampDelay(body.messageDelaySeconds) : (config.messageDelaySeconds ?? 0),
      };
      await saveConfig(kv, newConfig);
      return jsonResponse({ success: true });
    }
    return new Response(null, { status: 405 });
  }

  if (path === '/api/toggle' && request.method === 'POST') {
    if (!isAuthenticated) return jsonResponse({ error: 'Unauthorized' }, 401);
    const body = (await request.json()) as { enabled?: boolean };
    const newConfig: BotConfig = { ...config, enabled: body.enabled ?? !config.enabled };
    await saveConfig(kv, newConfig);
    return jsonResponse({ success: true, enabled: newConfig.enabled });
  }

  if ((path === '/' || path === '') && request.method === 'GET') {
    if (!isAuthenticated) {
      return new Response(getAdminLoginHtml(baseUrl), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    return new Response(getAdminPageHtml(baseUrl), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return new Response('Not Found', { status: 404 });
}

function getSetupWizardHtml(baseUrl: string): string {
  const adminUrl = `${baseUrl}/admin`;
  const defaultMsg = DEFAULT_WELCOME.replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Setup - Bluesky DM Reply Bot</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 500px; margin: 2rem auto; padding: 1rem; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    .sub { font-size: 0.9rem; color: #666; margin-bottom: 1.5rem; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
    .card h2 { font-size: 1rem; margin: 0 0 0.5rem 0; }
    label { display: block; margin-bottom: 0.25rem; font-weight: 500; font-size: 0.9rem; }
    input, textarea { width: 100%; padding: 0.5rem; margin-bottom: 0.75rem; border: 1px solid #ccc; border-radius: 4px; font-family: inherit; }
    textarea { min-height: 100px; resize: vertical; }
    button { padding: 0.5rem 1rem; background: #0085ff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
    button:hover { background: #0070dd; }
    .error { color: #c00; margin-bottom: 1rem; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>Bluesky DM Reply Bot — Setup</h1>
  <p class="sub">Configure your bot. You can change these later from the admin panel.</p>
  <div class="card">
    <h2>1. Admin password</h2>
    <p class="sub" style="margin:0 0 0.5rem 0; font-size: 0.8rem;">Used to log into the admin panel. Min 8 characters.</p>
    <label for="password">Password</label>
    <input type="password" id="password" placeholder="Choose a strong password" minlength="8" required>
  </div>
  <div class="card">
    <h2>2. Auto-reply message</h2>
    <p class="sub" style="margin:0 0 0.5rem 0; font-size: 0.8rem;">Sent when someone DMs your Bluesky account for the first time. Plain text only (max 1000 chars).</p>
    <label for="welcome">Message</label>
    <textarea id="welcome" maxlength="1000" placeholder="${defaultMsg}">${defaultMsg}</textarea>
    <span class="char-count" id="charCount">${defaultMsg.length} / 1000 characters</span>
  </div>
  <div class="card">
    <h2>3. Message delay</h2>
    <p class="sub" style="margin:0 0 0.5rem 0; font-size: 0.8rem;">Wait this many seconds before sending (0 = instant). Max 300.</p>
    <label for="delay">Delay (seconds)</label>
    <input type="number" id="delay" min="0" max="300" value="0" step="1" style="width: auto;">
  </div>
  <div class="card">
    <h2>4. Enable</h2>
    <p class="sub" style="margin:0 0 0.5rem 0; font-size: 0.8rem;">Start the auto-reply flow immediately?</p>
    <label><input type="checkbox" id="enabled" checked> Enable auto-replies</label>
  </div>
  <div id="error" class="error" style="display:none"></div>
  <button id="saveBtn">Complete Setup</button>
  <script>
    const adminUrl = '${adminUrl}';
    document.getElementById('welcome').addEventListener('input', function() {
      document.getElementById('charCount').textContent = this.value.length + ' / 1000 characters';
    });
    document.getElementById('saveBtn').addEventListener('click', async () => {
      const password = document.getElementById('password').value;
      const welcome = document.getElementById('welcome').value.trim() || '${defaultMsg}';
      const enabled = document.getElementById('enabled').checked;
      const delay = Math.min(300, Math.max(0, parseInt(document.getElementById('delay').value, 10) || 0));
      const errEl = document.getElementById('error');
      if (password.length < 8) {
        errEl.textContent = 'Password must be at least 8 characters';
        errEl.style.display = 'block';
        return;
      }
      try {
        const res = await fetch(adminUrl + '/api/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminPassword: password, welcomeMessage: welcome, enabled, messageDelaySeconds: delay })
        });
        const data = await res.json();
        if (res.ok) {
          window.location.href = adminUrl;
        } else {
          errEl.textContent = data.error || 'Setup failed';
          errEl.style.display = 'block';
        }
      } catch (e) {
        errEl.textContent = 'Network error';
        errEl.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;
}

function getAdminLoginHtml(baseUrl: string): string {
  const adminUrl = `${baseUrl}/admin`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Login</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 400px; margin: 2rem auto; padding: 1rem; }
    h1 { font-size: 1.25rem; margin-bottom: 1rem; }
    label { display: block; margin-bottom: 0.25rem; font-weight: 500; }
    input { width: 100%; padding: 0.5rem; margin-bottom: 1rem; border: 1px solid #ccc; border-radius: 4px; }
    button { width: 100%; padding: 0.75rem; background: #0085ff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
    button:hover { background: #0070dd; }
    .error { color: #c00; margin-bottom: 1rem; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>Admin Login</h1>
  <form id="loginForm">
    <label for="password">Password</label>
    <input type="password" id="password" placeholder="Admin password" required autocomplete="current-password">
    <div id="error" class="error" style="display:none"></div>
    <button type="submit">Sign in</button>
  </form>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value;
      const errEl = document.getElementById('error');
      try {
        const res = await fetch('${adminUrl}/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
          redirect: 'manual'
        });
        if (res.type === 'opaqueredirect' || res.status === 302) {
          window.location.href = '${adminUrl}';
          return;
        }
        const data = await res.json();
        errEl.textContent = data.error || 'Login failed';
        errEl.style.display = 'block';
      } catch (x) {
        errEl.textContent = 'Network error';
        errEl.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;
}

function getAdminPageHtml(baseUrl: string): string {
  const adminUrl = `${baseUrl}/admin`;
  const defaultMsg = DEFAULT_WELCOME.replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bluesky DM Reply Bot — Admin</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 680px; margin: 2rem auto; padding: 1rem; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    .sub { font-size: 0.9rem; color: #666; margin-bottom: 1.5rem; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
    .card h2 { font-size: 1rem; margin: 0 0 0.5rem 0; }
    label { display: block; margin-bottom: 0.25rem; font-weight: 500; font-size: 0.9rem; }
    input[type="number"] { padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; }
    textarea { width: 100%; min-height: 80px; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; font-family: inherit; resize: vertical; }
    button { padding: 0.5rem 1rem; background: #0085ff; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #0070dd; }
    .actions { display: flex; gap: 0.5rem; margin-top: 1rem; align-items: center; flex-wrap: wrap; }
    .status { font-size: 0.85rem; margin-top: 0.5rem; }
    .success { color: #080; }
    .char-count { font-size: 0.8rem; color: #666; display: block; margin-top: 0.25rem; }
    a { color: #0085ff; }
    .toggle-wrap { display: flex; align-items: center; gap: 0.75rem; }
    .toggle { position: relative; width: 52px; height: 28px; background: #ccc; border-radius: 14px; cursor: pointer; transition: background 0.2s; }
    .toggle.active { background: #0085ff; }
    .toggle::after { content: ''; position: absolute; width: 22px; height: 22px; background: white; border-radius: 50%; top: 3px; left: 3px; transition: left 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    .toggle.active::after { left: 27px; }
    .toggle-label { font-weight: 500; }
  </style>
</head>
<body>
  <h1>Bluesky DM Reply Bot</h1>
  <p class="sub">Configure the preset message sent when users DM your Bluesky account for the first time.</p>
  <div class="card">
    <h2>Flow status</h2>
    <div class="toggle-wrap">
      <div id="toggle" class="toggle" role="button" tabindex="0" aria-pressed="false"></div>
      <span id="toggleLabel" class="toggle-label">Off</span>
    </div>
    <p class="sub" style="margin: 0.5rem 0 0 0; font-size: 0.85rem;">When on, new users who DM you receive the auto-reply below. Runs on a schedule (every minute).</p>
  </div>
  <div class="card">
    <h2>Message delay</h2>
    <p class="sub" style="margin:0 0 0.5rem 0; font-size: 0.8rem;">Seconds to wait before sending (0 = instant). Max 300.</p>
    <label for="delay">Delay (seconds)</label>
    <input type="number" id="delay" min="0" max="300" value="0" step="1" style="width: 6em;">
  </div>
  <div class="card">
    <h2>Auto-reply message</h2>
    <p class="sub" style="margin:0 0 0.5rem 0; font-size: 0.8rem;">Sent once per user on their first DM. Plain text, max 1000 characters.</p>
    <label for="welcome">Message</label>
    <textarea id="welcome" maxlength="1000"></textarea>
    <span id="charCount" class="char-count">0 / 1000 characters</span>
  </div>
  <div class="actions">
    <button id="saveBtn">Save changes</button>
    <a href="${adminUrl}/logout" style="margin-left: auto;">Log out</a>
  </div>
  <div id="status" class="status"></div>
  <script>
    const adminUrl = '${adminUrl}';
    const defaultMsg = '${defaultMsg}';

    async function load() {
      const res = await fetch(adminUrl + '/api/config');
      if (res.status === 401) { window.location.reload(); return; }
      const data = await res.json();
      document.getElementById('welcome').value = data.welcomeMessage || defaultMsg;
      document.getElementById('charCount').textContent = (data.welcomeMessage || '').length + ' / 1000 characters';
      const delayInput = document.getElementById('delay');
      if (delayInput) delayInput.value = String(data.messageDelaySeconds ?? 0);
      const enabled = !!data.enabled;
      const tgl = document.getElementById('toggle');
      const lbl = document.getElementById('toggleLabel');
      tgl.classList.toggle('active', enabled);
      tgl.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      lbl.textContent = enabled ? 'On' : 'Off';
    }

    document.getElementById('welcome').addEventListener('input', function() {
      document.getElementById('charCount').textContent = this.value.length + ' / 1000 characters';
    });

    document.getElementById('toggle').addEventListener('click', async function() {
      const curr = this.classList.contains('active');
      const next = !curr;
      try {
        const res = await fetch(adminUrl + '/api/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next })
        });
        const data = await res.json();
        if (res.ok) {
          this.classList.toggle('active', data.enabled);
          this.setAttribute('aria-pressed', data.enabled ? 'true' : 'false');
          document.getElementById('toggleLabel').textContent = data.enabled ? 'On' : 'Off';
          document.getElementById('status').textContent = data.enabled ? 'Flow enabled' : 'Flow disabled';
          document.getElementById('status').className = 'status success';
          setTimeout(() => document.getElementById('status').textContent = '', 2000);
        }
      } catch (e) {
        document.getElementById('status').textContent = 'Failed to toggle';
      }
    });

    document.getElementById('saveBtn').addEventListener('click', async () => {
      const welcome = document.getElementById('welcome').value.trim() || defaultMsg;
      const delay = Math.min(300, Math.max(0, parseInt(document.getElementById('delay').value, 10) || 0));
      const res = await fetch(adminUrl + '/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ welcomeMessage: welcome, messageDelaySeconds: delay })
      });
      const data = await res.json();
      const st = document.getElementById('status');
      if (res.ok) {
        st.textContent = 'Saved.';
        st.className = 'status success';
        setTimeout(() => st.textContent = '', 2000);
      } else {
        st.textContent = data.error || 'Save failed';
      }
    });

    load();
  </script>
</body>
</html>`;
}
