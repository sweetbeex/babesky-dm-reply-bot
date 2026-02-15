# Bluesky DM Reply Bot

Automatically reply when someone sends you a direct message (DM) on Bluesky for the **first time**. You choose the message, add an optional delay, and control everything from a simple admin panel.

No coding experience needed—everything is set up through web dashboards.

---

## What You'll Need

- **A Bluesky account** — [Sign up at bsky.app](https://bsky.app) if you don't have one
- **A GitHub account** — [Sign up at github.com](https://github.com) (free)
- **A Cloudflare account** — [Sign up at dash.cloudflare.com](https://dash.cloudflare.com) (free)

---

## Setup Guide

Follow these steps in order. Take your time—each step has details to help you.

---

### Step 1: Fork the Repository on GitHub

A "fork" is your own copy of this project. Cloudflare can only deploy from repositories you own.

1. Open [github.com/sweetbeex/babesky-dm-reply-bot](https://github.com/sweetbeex/babesky-dm-reply-bot) in your browser
2. Click the **Fork** button (top right)
3. Click **Create fork**
4. You now have a copy at `github.com/YOUR-USERNAME/babesky-dm-reply-bot`

---

### Step 2: Create a Bluesky App Password

Your bot needs permission to read and send DMs on your behalf. An "app password" is a special password for apps—safer than using your main password.

1. Go to [bsky.app/settings/app-passwords](https://bsky.app/settings/app-passwords)
2. Click **Add App Password**
3. Give it a name (e.g. "DM Reply Bot")
4. **Important:** Check the box for **Allow access to your direct messages**
5. Click **Create App Password**
6. **Copy the password now** (e.g. `abcd-efgh-ijkl-mnop`) — you won't see it again. Save it somewhere safe.

---

### Step 3: Deploy the Bot on Cloudflare

Cloudflare Workers run your bot in the cloud. We'll connect your GitHub fork so it deploys automatically.

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and log in
2. In the left sidebar, click **Workers & Pages**
3. Click **Create application** → **Create Worker**
4. You'll see "Create a Worker" — click **Connect to Git**
5. Click **Connect GitHub** and authorize Cloudflare if asked
6. In the repository list, find **your fork** (e.g. `YOUR-USERNAME/babesky-dm-reply-bot`) and click it
7. Leave **Build configuration** as default (it uses settings from the project)
8. Click **Save and Deploy**
9. Wait for the deployment to finish
10. Click **Continue to Worker** — you'll see your worker name and a URL like `https://your-worker-name.your-subdomain.workers.dev`. **Save this URL**; you'll need it later.

---

### Step 4: Create a Storage Space (KV Namespace)

The bot needs a place to store its settings. Cloudflare KV is simple key-value storage.

1. In the left sidebar, click **KV**
2. Click **Create a namespace**
3. Name it `BOT_CONFIG` (type it exactly like this)
4. Click **Add**

---

### Step 5: Attach the Storage to Your Worker

1. Go back to **Workers & Pages** and click **your worker name**
2. Open the **Settings** tab
3. Scroll down to **Variables and Secrets**
4. Find **KV Namespace Bindings** and click **Add binding**
5. Set **Variable name** to `BOT_CONFIG` (exactly)
6. In the dropdown, select the `BOT_CONFIG` namespace you created
7. Click **Save**
8. If it asks to deploy, click **Save and deploy**

---

### Step 6: Add Your Secrets and Variables

The bot needs your Bluesky credentials and a secret for the admin panel. Add these under **Variables and Secrets** (same place as Step 5).

#### Encrypted (secret) variables — click **Add** for each:

| Variable name | Value |
|---------------|-------|
| `BSKY_HANDLE` | Your Bluesky handle, e.g. `jane.bsky.social` |
| `BSKY_APP_PASSWORD` | The app password from Step 2 |
| `ADMIN_SESSION_SECRET` | A long random string. Generate one at [randomkeygen.com](https://randomkeygen.com/) — use a "CodeIgniter Encryption Key" or similar (32+ characters). Copy and paste it. |

#### Optional (non-secret) variables:

| Variable name | Value |
|---------------|-------|
| `WEBHOOK_BASE_URL` | Your worker URL from Step 3 (e.g. `https://your-worker.your-subdomain.workers.dev`). Only needed if the admin panel has redirect issues. |

When adding variables:
- Choose **Encrypted** for secrets (the password and keys)
- Type the variable name exactly (case-sensitive)
- Click **Save and deploy** when done

---

### Step 7: Add the Cron Trigger (Schedule)

The bot runs every minute to check for new DMs. Cloudflare should add this automatically; if not:

1. In your worker, go to **Settings** → **Triggers**
2. Under **Cron Triggers**, click **Add**
3. Enter: `* * * * *` (means "every minute")
4. Save

---

### Step 8: Complete the Bot Setup

1. Open your worker URL + `/admin` in your browser, e.g. `https://your-worker.your-subdomain.workers.dev/admin`
2. You'll see the setup wizard. Fill in:
   - **Admin password** — A password to protect the admin panel (min 8 characters). You'll use this to log in later.
   - **Auto-reply message** — The message sent to people who DM you for the first time (e.g. "Hi! Thanks for reaching out. I'll get back to you soon.")
   - **Message delay** — Seconds to wait before sending (0 = instant). Helps avoid spam flags; 5–30 seconds is a good starting point.
   - **Enable auto-replies** — Check this to turn the bot on
3. Click **Complete Setup**

---

### Step 9: Use the Admin Panel Anytime

- Visit `https://YOUR-WORKER-URL/admin`
- Log in with your admin password
- Toggle the bot **On** or **Off**
- Edit the message and delay, then click **Save changes**
- Log out when done

---

## How It Works

1. **Every minute**, the bot checks your Bluesky DMs
2. For each conversation where **the last message is from someone else** and **you’ve never messaged them before** (brand-new conversation), it sends your preset message
3. **Existing conversations are skipped** — if you’ve already chatted with someone, the bot will not auto-reply when they message again
4. **Each person gets the auto-reply at most once** — first-time-only for new conversations
5. The bot is designed to stay well under Bluesky's rate limits and avoid spam flags (see below)

---

## Rate Limits & Spam Safety

The bot is built to stay within Bluesky's limits and avoid triggering spam protections:

- **New conversations only** — Skips people you’ve already chatted with. When you turn it on, it won’t auto-reply to existing contacts.
- **One reply per user ever** — Each account receives the auto-reply at most once, period. Stored in KV for 1 year.
- **Max 10 replies per run** — Even with many new DMs, we cap at 10 per minute
- **Delay between sends** — When replying to multiple people, the bot waits 3 seconds between each message
- **429 handling** — If Bluesky returns "rate limited," the bot stops and waits for the next scheduled run
- **Polls every minute** — ~1,440 checks per day, well under API limits

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| **Setup wizard won't load** | Make sure you created the KV namespace and attached it (Steps 4–5). The variable name must be exactly `BOT_CONFIG`. |
| **"Admin not configured"** | Add `ADMIN_SESSION_SECRET` as an encrypted variable (Step 6). |
| **"XRPCNotSupported" or DM errors** | Create a new Bluesky app password with **"Allow access to your direct messages"** checked (Step 2). |
| **No auto-replies** | Check: cron trigger is set, `BSKY_HANDLE` and `BSKY_APP_PASSWORD` are correct, and the flow is **On** in the admin panel. |
| **Can't find my worker URL** | Workers & Pages → your worker → the URL is shown at the top, or in the Triggers/Routes section. |

---

## What's Stored (KV Keys)

| Key | Purpose |
|-----|---------|
| `config` | Your settings (message, on/off, delay, admin password hash) |
| `bsky_session` | Cached Bluesky login (expires in 1 hour) — reduces API calls |
| `replied:<userDid>` | Marks users who already received the auto-reply (expires in 1 year) |

---

## Features

- **First-DM only** — Each person gets the reply once
- **Setup wizard** — Configure everything in one flow
- **Admin panel** — Toggle on/off, edit message and delay
- **Message delay** — 0–300 seconds before sending (helps with spam)
- **No coding** — All setup through web dashboards
