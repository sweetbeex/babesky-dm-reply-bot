export interface Env {
  BOT_CONFIG: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  /**
   * Secret for signing admin session cookies. Required for /admin.
   */
  ADMIN_SESSION_SECRET?: string;
  WEBHOOK_BASE_URL?: string;
}

export interface BotConfig {
  welcomeMessage: string;
  enabled: boolean;
  /** Delay in seconds before sending the welcome message (0 = no delay) */
  messageDelaySeconds: number;
  /** SHA-256 hash of admin password (hex) */
  adminPasswordHash?: string;
  /** True if initial setup has been completed */
  setupComplete: boolean;
}
