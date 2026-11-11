# Leash

Leash is a safety layer between AI shopping agents and payments, enforcing signed spending mandates and policy checks before PayPal transactions can be authorized and captured.

Requires Node 20 or newer and recent npm; install scripts for better-sqlite3 and esbuild must be allowed (the committed allowlist already does this).

## Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | HTTP port the server listens on | `3001` |
| `NODE_ENV` | Application environment (`development` or `production`) | `development` |
| `DATABASE_PATH` | Path to SQLite database | `leash.db` |
| `MANDATE_SIGNING_SECRET` | Secret key used for HMAC SHA-256 signing of mandates | *(required)* |
| `PUBLIC_BASE_URL` | Public origin URL for redirects and production static serving | `http://localhost:3001` |
| `PAYPAL_MODE` | PayPal integration mode (`mock` or `sandbox`) | `mock` |
| `PAYPAL_CLIENT_ID` | PayPal sandbox client ID | *(optional in mock)* |
| `PAYPAL_CLIENT_SECRET` | PayPal sandbox client secret | *(optional in mock)* |
| `PAYPAL_WEBHOOK_ID` | PayPal sandbox webhook ID for signature verification | *(optional in mock)* |
| `LLM_PROVIDER` | LLM adapter provider (`gemini`) | `gemini` |
| `LLM_MODEL` | LLM model identifier | `gemini-1.5-flash` |
| `LLM_API_KEY` | API key for Gemini / LLM provider | *(required for agent)* |
| `CHANNEL3_API_KEY` | API key for Channel3 product search | *(optional, falls back to catalog)* |
| `AGENT_NAIVE` | Use naive prompt for prompt injection testing (`true` or `false`) | `false` |
| `AGENT_DEMO_ATTACK` | Trigger attack scenario in demo (`true` or `false`). Set to `true` on Render deploy | `false` |
