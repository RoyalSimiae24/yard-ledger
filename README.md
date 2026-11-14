# Yard Ledger

Offline Windows job, client, invoice and price-list tracker for Lima's Landscaping.

- `app/` is the app source (Electron).
- `updates/` holds the latest packaged update (`app.asar`) and `update.json` (version and SHA-256). Installed copies check this folder when they open and update themselves.

Business data (jobs, clients, invoices) lives only on each computer and is never uploaded here.
