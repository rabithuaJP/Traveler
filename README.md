# Traveler

Traveler is an open-source, personality-driven web reader bot.

It periodically reads sources you care about, curates a small number of items,
and writes the best ones into **Rote** as notes — with a consistent voice.

## Goals

- **Low-noise**: if nothing is worth saving, it writes nothing.
- **Configurable**: persona, interests, sources, and output rules are all
  configurable.
- **Safe by default**: no secrets in git; always include source URLs; avoid
  overconfident claims.
- **OpenClaw-friendly**: designed to be run by OpenClaw cron / sessions.

## Quick start

### 1) Requirements

- Deno 2.x
- A Rote OpenKey with permissions:
  - `SENDROTE` (write notes)
  - `GETROTE` (optional, later)

### 2) Configure env

```bash
cp .env.example .env
# edit .env
```

### 3) Run once

```bash
deno task run -- run --config configs/default.yaml
```

It will fetch the configured RSS feeds, pick up to `ranking.daily_limit` items,
and write them to Rote.

## Configuration

See `configs/default.yaml`. All fields are optional.

## OpenClaw integration

You can run Traveler via OpenClaw `cron` (recommended) so it runs daily without
manual intervention.

Typical pattern:

- A cron job triggers a `sessions_spawn` task "Traveler daily run"
- The task runs the Deno command and then writes selected items into Rote

## Development

```bash
deno fmt
deno check src/cli.ts
```

## License

MIT
