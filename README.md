# Patientportal

A way to locate patients in a hospital ward. Made for nurses, caretakers and administrators.

## Development

First, run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Any changes made in the code will automatically show up in the browser, without needing to refresh the page.

## Testing

```bash
pnpm test              # unit tests (Vitest) — no external services needed
pnpm test:integration  # RLS + DB-constraint tests against a local Supabase stack
pnpm test:e2e          # Playwright E2E against the app running on the local stack
```

`test:integration` and `test:e2e` need `supabase start` running first (they talk to
the local stack, never the hosted project) and seed their own `*@test.local` role
accounts on each run. `test:e2e` also needs Playwright's browser installed once via
`npx playwright install chromium`, and runs against `pnpm dev` on `http://127.0.0.1:3000`
(reusing an already-running dev server if there is one).

## License

This repository is not licensed under the MIT License. All rights are reserved by the authors.
