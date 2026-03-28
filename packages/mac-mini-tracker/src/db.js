import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')

mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(join(DATA_DIR, 'listings.db'))

db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    finn_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    price INTEGER,
    model TEXT,
    ram TEXT,
    storage TEXT,
    condition TEXT,
    location TEXT,
    listing_url TEXT,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    listing_date TEXT,
    status TEXT DEFAULT 'active',
    estimated_sold_date TEXT,
    sold_price INTEGER,
    openclaw_status TEXT DEFAULT 'none',
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finn_id TEXT NOT NULL,
    price INTEGER NOT NULL,
    observed_at TEXT NOT NULL,
    FOREIGN KEY (finn_id) REFERENCES listings(finn_id)
  );

  CREATE TABLE IF NOT EXISTS scan_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scanned_at TEXT NOT NULL,
    listings_found INTEGER,
    new_listings INTEGER,
    price_changes INTEGER,
    newly_sold INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
  CREATE INDEX IF NOT EXISTS idx_listings_model ON listings(model);
  CREATE INDEX IF NOT EXISTS idx_price_history_finn_id ON price_history(finn_id);
`)

export default db
