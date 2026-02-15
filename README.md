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

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456789:ABCdefGHI...`)

### 2. Create KV Namespace

```bash
npx wrangler kv namespace create BOT_CONFIG
```

Copy the `id` from the output and paste it into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "BOT_CONFIG"
id = "YOUR_GENERATED_ID_HERE"
```

### 3. Set Secrets

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
# Paste your bot token from @BotFather

npx wrangler secret put ADMIN_SESSION_SECRET
# Use a random 32+ character string (e.g. openssl rand -hex 32)
```

### 4. Set Webhook Base URL (optional)

In `wrangler.toml`, set `WEBHOOK_BASE_URL` to your deployed worker URL:

```toml
[vars]
WEBHOOK_BASE_URL = "https://telegram-welcome-bot.your-subdomain.workers.dev"
```

### 5. Deploy

```bash
npm install
npm run deploy
```

### 6. Register Telegram Webhook

After deploy, register your webhook URL with Telegram:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://YOUR_WORKER_URL/webhook/telegram"
```

Replace:
- `<YOUR_BOT_TOKEN>` with your actual token
- `YOUR_WORKER_URL` with your deployed worker URL (e.g. `telegram-welcome-bot.your-subdomain.workers.dev`)

### 7. Initial Setup

1. Open `https://YOUR_WORKER_URL/admin`
2. Complete the setup wizard:
   - Set an admin password (min 8 chars)
   - Set your welcome message
   - Set message delay (seconds, 0 = instant)
   - Enable or disable the flow
3. Click **Complete Setup**

### 8. Use the Admin Panel

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

## Local Development

```bash
npm run dev
```

Use a tool like [ngrok](https://ngrok.com/) to expose your local server and set the Telegram webhook to the ngrok URL for testing.

## Troubleshooting

- **Bot not responding**: Check that the webhook is set: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`
- **Admin page shows "Admin not configured"**: Set `ADMIN_SESSION_SECRET` via `wrangler secret put`
- **Setup wizard keeps showing**: Ensure `BOT_CONFIG` KV namespace exists and the binding is correct
