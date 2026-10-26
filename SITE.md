# Your site

This is the team's website. It's a [TanStack Start](https://tanstack.com/start)
app (React + Vite + Tailwind), served on **port 3000**. It starts life as a simple
"coming soon" placeholder (the headline reads the business name from `site.json` at
request time), but it's a real full-stack framework — build it out into the real
site and grow it into a dynamic app without changing hosting or starting a second
server.

## Layout

```
src/
  routes/
    __root.tsx     # the HTML shell: <head>, fonts, global layout
    index.tsx      # the landing page ("/")
  styles/app.css   # Tailwind entrypoint + base styles
vite.config.ts     # serves on 0.0.0.0:3000
```

Add a page by creating a new file under `src/routes/` — e.g. `about.tsx` becomes
`/about`. Files are routes; the router is generated automatically.

## Serving and shipping

How this site is served and how changes go live **depends on the team's setup**:
your system prompt's **Website** section is the authority — follow it, not this
file. The `package.json` scripts (`publish`, `go-live`) exist for setups whose
Website section tells you to run them; don't run them otherwise. Server logs live
in `.run/`.

## Making it dynamic

The site is static today, but adding backend behavior is one file away — no second
process, no extra port, all served on the same port 3000:

- **Server function** — call server-only code (DB, secrets, fetch) directly from a
  component:

  ```tsx
  import { createServerFn } from "@tanstack/react-start";

  const getMessage = createServerFn().handler(async () => {
    return { message: "Hello from the server" };
  });
  ```

- **API route** — add `src/routes/api/<name>.ts` for a REST endpoint.
- **Slow handlers** — `serve.ts` sets Bun's `idleTimeout` to 255s; keep that line.
  With Bun's default (10s) a handler that waits on an AI provider is cut at ~12s and
  the visitor sees an empty 502. Use `createServerFn({ method: "POST" })` for work
  that costs money, so the gateway never re-sends it, and prefer streaming or a
  start-then-poll pair for anything that regularly runs past ~20s.

## Secrets

Read the owner's secrets from `process.env` in server-only code. Never put them in a
`.env` file: `.env` files are not published, so a value that only lives there is
missing on the live site.

## Adding a backend

When the site needs to store data (form submissions, content, accounts) or sign users
in, use a hosted service rather than writing to files or storing passwords yourself.
This template ships with no backend; any service with a JavaScript client works.

1. Get the service the way your instructions describe, and follow its own setup steps
   (install its client with `bun add`).
2. Its keys are secrets: read them from `process.env` in server-only code (a
   `createServerFn()` handler or an `src/routes/api/*` route), never in the browser.
   Check one is set without printing it: `test -n "$DATABASE_URL" && echo set`.
3. Check who the user is on the server before you read or write anything that belongs
   to one user. The browser can be lied to; the server can't.

A secret is in your environment automatically once it is saved, and it reaches the
published site too: saving or changing one restarts the live site with the new value
within seconds, no republish needed. The same code works in the preview and in
production. (On external hosting via `bun run go-live`, re-run it after a secret is
set so that host picks it up.)
