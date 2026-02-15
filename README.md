# Bluesky DM Reply Bot

A Bluesky bot that sends a preset auto-reply message when users DM your account for the **first time**. Features an admin panel with setup flow, configurable message, message delay, and on/off toggle.

Runs on Cloudflare Workers. Uses a cron trigger to poll for new DMs every minute.

## Features

- **First-DM only**: Each user receives the auto-reply once. Subsequent messages get no reply.
- **Setup wizard**: On first run, configure admin password, auto-reply message, message delay, and enable/disable.
- **Admin panel**: Log in to edit the message, set send delay, and toggle the flow on/off.
- **Message delay**: Configurable delay (0–300 seconds) before sending the reply.

## Setup

All setup is done through the Cloudflare Dashboard—no terminal required.

### 1. Create a Bluesky App Password

1. Go to [bsky.app/settings/app-passwords](https://bsky.app/settings/app-passwords)
2. Create a new app password
3. **Important**: Enable **"Allow access to your direct messages"**
4. Copy the app password (e.g. `xxxx-xxxx-xxxx-xxxx`)

### 2. Deploy the Worker from GitHub

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages**
2. Click **Create application** → **Create Worker**
3. Choose **Connect to Git**
4. Select **GitHub** and authorize if needed
5. Choose the `sweetbeex/babesky-dm-reply-bot` repo
6. Under **Build configuration**, leave the defaults (uses `wrangler.toml` from the repo)
7. Click **Deploy**

### 3. Create KV Namespace

1. In the Cloudflare Dashboard, go to **Workers & Pages** → **KV**
2. Click **Create a namespace**
3. Name it `BOT_CONFIG` (or any name you prefer)
4. Click **Add**

### 4. Link KV Namespace to Your Worker

1. Go to **Workers & Pages** → select your worker
2. Open **Settings** → **Variables and Secrets**
3. Scroll to **KV Namespace Bindings**
4. Click **Add binding**
5. Set **Variable name** to `BOT_CONFIG`
6. Select the namespace you created
7. Click **Save and deploy**

### 5. Add Environment Variables and Secrets

1. Still in **Settings** → **Variables and Secrets**
2. Add **Encrypted** (secrets):
   - **Variable name:** `BSKY_HANDLE` — **Value:** your Bluesky handle (e.g. `you.bsky.social`)
   - **Variable name:** `BSKY_APP_PASSWORD` — **Value:** your app password (with DM permission)
   - **Variable name:** `ADMIN_SESSION_SECRET` — **Value:** a random 32+ character string (e.g. generate at [randomkeygen.com](https://randomkeygen.com/))
3. Optionally add **Environment variables** (non-secret):
   - **Variable name:** `BSKY_SERVICE_URL` — **Value:** `https://bsky.social` (default)
   - **Variable name:** `WEBHOOK_BASE_URL` — **Value:** your worker URL (e.g. `https://babesky-dm-reply-bot.your-subdomain.workers.dev`)
4. Click **Save and deploy**

### 6. Verify Cron Trigger

The worker runs on a schedule (every minute) to check for new DMs. In **Workers & Pages** → your worker → **Settings** → **Triggers**, you should see a cron trigger `* * * * *`. If not, add it.

### 7. Initial Setup

1. Open `https://YOUR_WORKER_URL/admin`
2. Complete the setup wizard:
   - Set an admin password (min 8 chars)
   - Set your auto-reply message
   - Set message delay (seconds, 0 = instant)
   - Enable or disable the flow
3. Click **Complete Setup**

### 8. Use the Admin Panel

- Visit `https://YOUR_WORKER_URL/admin`
- Log in with your admin password
- Toggle the flow on/off with the switch
- Edit the message and delay, then click **Save changes**
- Log out when done

## How It Works

1. **Cron runs every minute** on Cloudflare
2. Worker logs in to your Bluesky account
3. Fetches list of conversations
4. For each convo where the **last message is from the other user** (not you) and you **haven't replied yet** → waits for configured delay → sends your preset message
5. Marks that user as "replied" so they won't get it again

## KV Keys

| Key | Purpose |
|-----|---------|
| `config` | Bot configuration (message, enabled, delay, admin password hash) |
| `replied:<userDid>` | Marks a user as already replied to (TTL: 1 year) |

## Troubleshooting

- **No auto-replies**: Ensure the cron is running (check Triggers), `BSKY_HANDLE` and `BSKY_APP_PASSWORD` are set, and the flow is **On** in the admin panel.
- **"XRPCNotSupported" or DM errors**: Create a new Bluesky app password with **"Allow access to your direct messages"** checked.
- **Admin page shows "Admin not configured"**: Add `ADMIN_SESSION_SECRET` as an encrypted variable.
- **Setup wizard keeps showing**: Ensure the `BOT_CONFIG` KV namespace is created and linked under Settings → KV Namespace Bindings.
