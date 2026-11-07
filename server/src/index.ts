import "dotenv/config";
import { createDb } from "./db.js";
import { createApp } from "./app.js";

const signingSecret = process.env.MANDATE_SIGNING_SECRET;
if (!signingSecret) {
  process.stderr.write(
    "MANDATE_SIGNING_SECRET environment variable is required\n",
  );
  process.exit(1);
}

const dbPath = process.env.DATABASE_PATH || "leash.db";
const db = createDb(dbPath);
const app = createApp(db, { signingSecret });

const port = Number(process.env.PORT) || 3001;

app.listen(port, () => {
  process.stdout.write(`Server listening on port ${port}\n`);
});
