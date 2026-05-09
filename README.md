# Compound

Autonomous research agent for your second brain. Reads arxiv while you sleep, adds findings to your Obsidian vault as wikilinked notes, uses your unused Claude routines to do the work.

Built at [Nozomio Hackathon](https://www.nozomio.com/) — May 9, 2026.

## What it does

- Watches your Obsidian vault for active topics
- Reads new arxiv papers / blogs in those topics overnight
- Cross-references findings with your existing notes
- Adds new notes with auto-generated `[[wikilinks]]`
- Lives in Telegram — text it, get autonomous responses

## The pain

You pay $20–25/mo for Claude.ai. You typically use 10–30% of your weekly capacity. The rest resets unused. Meanwhile arxiv publishes 100+ papers a day in your domain. Your vault notes go stale. Your active thinking and the external world stay disconnected.

Compound bridges them — it monetizes your idle Claude capacity into vault growth.

## Stack

- [Next.js](https://nextjs.org/) + Tailwind + Vercel
- [Convex](https://www.convex.dev/) — real-time backend, scheduled functions
- [Tensorlake](https://tensorlake.ai/) — stateful named sandbox per topic area
- [Nia](https://www.trynia.ai/) — local vault indexing (Sync daemon) + external content
- Telegram Bot API
- Claude API (Sonnet 4.6)

## Status

🛠 In active development. Solo build.

## License

MIT
