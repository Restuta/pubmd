# Domain Search Kit — Publish It

## How to use

1. Put your Fastly API key in `.env` file
2. Open this folder in Claude Code
3. Paste the prompt below to start a session

## Setup

Create a `.env` file in this folder:
```
FASTLY_KEY=your_fastly_key_here
```

## The Script

```bash
# Check words against all default TLDs
node check-domains.js word1 word2 word3

# Check specific TLDs only
node check-domains.js --tld sh,dev,io word1 word2

# Check exact domain hacks
node check-domains.js --full publi.sh publish.it getl.ink pag.es

# Pipe words in
echo "pub ink post" | node check-domains.js
```

## Starting Prompt for Claude

---

I'm searching for a domain for "Publish It" — a no-bullshit, AI-native CLI publishing service (think telegra.ph but AI-powered).

Read the files in this folder:
- `domain-search.md` — the main doc with VIP list and criteria
- `check-domains.js` — multi-TLD availability checker (Fastly API)
- `checked-domains.json` — dedup database
- `starting-prompt.md` — this file

The process:
1. Brainstorm domain names (focus on domain hacks and ultra-short names)
2. Check availability via: `node check-domains.js [--full] [--tld sh,dev] word1 word2`
3. Add available domains to the doc
4. I mark favorites with [x], you promote to VIP
5. Archive unmarked between rounds

What I want:
- SHORT (5 chars total ideal, including the dot+TLD)
- Domain hacks where TLD completes a word (publi.sh, pag.es, l.ink)
- CLI/terminal feel — should feel like a command
- No corporate BS — direct, punchy
- Under $100/year if possible
- Publishing, writing, posting, linking angle
- Double meanings and cleverness welcome

Target TLDs: .sh, .dev, .io, .is, .ink, .to, .it, .es, .pub, .page, .press, .run, .app, .ai

Start by reading the doc, then brainstorm the first round.

---
