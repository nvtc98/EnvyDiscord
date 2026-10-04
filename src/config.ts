export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example`);
  return value;
}

export function loadConfig() {
  return {
    token: requireEnv('DISCORD_TOKEN'),
    dataFile: process.env.DATA_FILE?.trim() || 'data/players.json',
    timezone: process.env.BOT_TZ?.trim() || 'Asia/Ho_Chi_Minh',
    logDir: process.env.LOG_DIR?.trim() || 'logs',
    /** Set LOG_CONTENT=false to log who/when/what-kind but not the message text. */
    logContent: process.env.LOG_CONTENT?.trim().toLowerCase() !== 'false',
  };
}
