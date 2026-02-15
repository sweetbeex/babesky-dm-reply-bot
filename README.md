# Telegram Welcome Bot

A Telegram bot that sends a preset welcome message to users the **first time** they DM your bot. Features an admin panel with setup flow, configurable welcome message, message delay, and on/off toggle.

Runs on Cloudflare Workers.

## Features

- **First-DM only**: Each user receives the welcome message once. Subsequent messages get no auto-reply.
- **Setup wizard**: On first run, configure admin password, welcome message, message delay, and enable/disable.
- **Admin panel**: Log in to edit the welcome message, set send delay, and toggle the flow on/off.
- **Message delay**: Configurable delay (0–300 seconds) before sending the welcome message.
- **HTML support**: Welcome message supports Telegram HTML formatting (e.g. `<b>bold</b>`).

## Setup

All setup is done through the Cloudflare Dashboard—no terminal required.

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456789:ABCdefGHI...`)

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

### 5. Add Secrets

1. Still in **Settings** → **Variables and Secrets**
2. Under **Encrypted variables**, click **Add**
3. Add:
   - **Variable name:** `TELEGRAM_BOT_TOKEN` — **Value:** your bot token from @BotFather
   - **Variable name:** `ADMIN_SESSION_SECRET` — **Value:** a random 32+ character string (e.g. generate at [randomkeygen.com](https://randomkeygen.com/))
4. Click **Save and deploy**

### 6. Set Webhook Base URL (optional)

1. In **Settings** → **Variables and Secrets**
2. Under **Environment variables**, click **Add**
3. **Variable name:** `WEBHOOK_BASE_URL`
4. **Value:** your worker URL (e.g. `https://babesky-dm-reply-bot.your-subdomain.workers.dev`)
5. Click **Save and deploy**

### 7. Register Telegram Webhook

Open this URL in your browser (replace the placeholders):

```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://YOUR_WORKER_URL/webhook/telegram
```

- Replace `<YOUR_BOT_TOKEN>` with your bot token
- Replace `YOUR_WORKER_URL` with your worker URL (e.g. `babesky-dm-reply-bot.your-subdomain.workers.dev`)

You should see `{"ok":true,"result":true,...}` in the browser.

### 8. Initial Setup

1. Open `https://YOUR_WORKER_URL/admin`
2. Complete the setup wizard:
   - Set an admin password (min 8 chars)
   - Set your welcome message
   - Set message delay (seconds, 0 = instant)
   - Enable or disable the flow
3. Click **Complete Setup**

### 9. Use the Admin Panel

- Visit `https://YOUR_WORKER_URL/admin`
- Log in with your admin password
- Toggle the flow on/off with the switch
- Edit the welcome message and delay, then click **Save changes**
- Log out when done

## How It Works

1. User DMs your bot (sends `/start` or any message)
2. If the flow is **enabled** and the user hasn't been welcomed before → wait for the configured delay → bot sends the welcome message
3. User ID is stored in KV so they won't receive it again

## KV Keys

| Key | Purpose |
|-----|---------|
| `config` | Bot configuration (welcome message, enabled, delay, admin password hash) |
| `welcomed:<userId>` | Marks a user as already welcomed (TTL: 1 year) |

## Troubleshooting

- **Bot not responding**: Open `https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo` in your browser to check if the webhook URL is set correctly.
- **Admin page shows "Admin not configured"**: Add `ADMIN_SESSION_SECRET` as an encrypted variable in Cloudflare Dashboard → Worker → Settings → Variables and Secrets.
- **Setup wizard keeps showing**: Ensure the `BOT_CONFIG` KV namespace is created and linked to your worker under Settings → Variables and Secrets → KV Namespace Bindings.
