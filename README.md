# HTOS

Existing Hare & Tortoise operations application. Production: https://htosuk.vercel.app. The previous htos-ten address is retired and must not be reactivated.

This repository contains the existing React/Vite/Express/Firebase application, assets, tests and deployment configuration. It does not contain production records, private project notes, passwords or server credentials. Existing business records remain in the existing database. Unused embedded business seed lists have been removed.

Use Node 24 and npm. Install with `npm ci`, then run `npm test`, `npm run lint` and `npm run build`. The build includes the network-blocked native server startup check. `.env.example` provides isolated emulator configuration; do not test against production data. Configure production settings privately in the existing Vercel project.

`app-version.json` is the visible version source of truth. Read `AGENTS.md` before making changes. Preserve server and interface permissions, branding, the three-column checklist and unfinished-work protection. No proposed invoice features are enabled by this source upload. The Standard Menu source is retained as existing separate development work; it is not released by the operations build.

The full project brief and decision history remain private in the maintained app folder. This is a source snapshot, not a database backup.
