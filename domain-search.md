# Domain Search — Publish It (No Bullshit Publishing Service)

## Concept

AI-native, CLI publishing tool. Think telegra.ph but with AI. URLs need to be short and clever.
The name itself should feel like a command you'd type in a terminal.

## API Reference (Fastly Domain Research / Domainr)

```bash
# Status check (single domain)
curl -s -H "Fastly-Key: YOUR_KEY" \
  "https://api.fastly.com/domain-management/v1/tools/status?domain=publi.sh"

# Batch check via script
node check-domains.js word1 word2 word3
node check-domains.js --full publi.sh publish.it getl.ink
node check-domains.js --tld sh,dev,io word1 word2
```

**Tools:**
- [check-domains.js](check-domains.js) — check availability + dedup (multi-TLD)
- [checked-domains.json](checked-domains.json) — dedup database

**Status meanings:**
- `inactive` = available for registration
- `active` = registered/taken
- `premium` = registry premium pricing
- `marketed priced` = listed for sale on aftermarket

---

## Target TLDs (ranked by preference)

1. `.sh` — shell script vibes, perfect for CLI tool (publi.sh, pu.sh)
2. `.dev` — developer-first
3. `.io` — startup classic
4. `.is` — "this is..." or Icelandic
5. `.ink` — writing/publishing (l.ink = link!)
6. `.to` — action/destination
7. `.it` — "do it" / Italian
8. `.es` — pag.es, not.es
9. `.pub` — publishing!
10. `.page` — single page
11. `.press` — publishing
12. `.run` — CLI command vibes
13. `.app` — app store presence
14. `.ai` — AI native angle

### Domain Hack TLDs (word ends with TLD)

The best domains are "hacks" where the TLD completes the word:
- `publi.sh` (.sh) — "publish"
- `publish.it` (.it) — "publish it"
- `pag.es` (.es) — "pages"
- `l.ink` (.ink) — "link"
- `pos.to` (.to) — "post to"
- `wr.it` (.it) — "writ"
- `subm.it` (.it) — "submit"
- `depo.sh` (.sh) — "deposh" ~deposit
- `prin.to` (.to) — "print to"

---

## VIP List

| Fav | Domain | Len | Price | Punchline |
|---|---|---|---|---|
| [x] | bul.sh | 6 | PURCHASED | "No bul.sh" = no bullshit. THE domain for this brand. .sh = shell = CLI. 3 letters before dot. Ultra-short URLs: bul.sh/post |
| [ ] | pub.ink | 7 | $248 | "Publishing ink." Clean, professional, publishing-first. Both words are on-brand. Best price-to-quality ratio of anything found. |
| [ ] | go.ink | 6 | premium | "Go ink!" = go publish. Action verb + writing. 2 letters before dot. go.ink/post is gorgeous. |
| [ ] | al.ink | 6 | premium | Reads as "a link." Every published page IS a link. Meta and perfect. al.ink/my-post = "a link to my post." |
| [ ] | nb.pub | 6 | premium | "No Bullshit Pub." Brand initials + publish TLD. If you know, you know. 2 letters before dot. |
| [ ] | it.ink | 6 | premium | "Publish it. In ink." Snappy, short. The "it" reads like a command argument. |
| [ ] | nobs.sh | 7 | FREE | "No BS" + shell. Most explicit brand reference that's available. CLI-native. |
| [ ] | hue.ink | 7 | FREE | "Hue of ink." Beautiful, evocative. Stands out from techy names. Free! |
| [ ] | lit.ink | 7 | premium | "Lit ink" = fire/literature double meaning. Gen Z "lit" + classic "literary." |
| [ ] | set.ink | 7 | $472 | "Set in ink" = permanent, published, final. Once you publish, it's set. |
| [ ] | vim.pub | 7 | FREE | Vim the editor + publishing. Every dev knows vim. Free! |
| [ ] | nah.pub | 7 | FREE | "Nah" = dismissive, no-BS attitude. "Nah, just publish it." Free! |
| [ ] | sett.ink | 8 | FREE | Reads as "setting" = typesetting! Publishing craft reference. Free! |
| [ ] | pen.ink | 7 | premium | "Pen and ink." The oldest writing tools. Classic, timeless. |
| [ ] | do.pub | 6 | premium | "Do publish." Imperative command. 2 letters before dot. |

---

## Other Available Domains (check = promote to VIP)

### Free (standard registration)

| Fav | Domain | Len | Notes |
|---|---|---|---|
| [ ] | bul.sh | 6 | "bullsh*t" — the no-BS brand domain |
| [ ] | nobs.sh | 7 | "no BS" + shell |
| [ ] | nobs.ink | 8 | "no BS ink" |
| [ ] | nobs.pub | 8 | "no BS pub" |
| [ ] | nbs.pub | 7 | "NBS" = No BS pub |
| [ ] | hue.ink | 7 | beautiful, "hue of ink" |
| [ ] | vim.pub | 7 | the editor + publishing |
| [ ] | nah.pub | 7 | dismissive, no-BS attitude |
| [ ] | orb.pub | 7 | spherical, abstract |
| [ ] | sett.ink | 8 | "typesetting" |
| [ ] | spew.sh | 7 | "spew" content out |
| [ ] | spew.ink | 8 | spew ink |
| [ ] | repu.sh | 7 | "repush" = republish? |
| [ ] | printe.rs | 9 | "printers" — .rs hack |
| [ ] | thx.pub | 7 | thanks + pub |
| [ ] | yep.pub | 7 | "yep, published" |
| [ ] | yup.pub | 7 | "yup, done" |
| [ ] | heh.pub | 7 | cheeky |
| [ ] | eek.pub | 7 | interjection |

### Premium (price TBD — may be affordable)

| Fav | Domain | Len | Notes |
|---|---|---|---|
| [ ] | ax.ink | 6 | ultra-short 2-letter .ink |
| [ ] | ad.ink | 6 | ultra-short |
| [ ] | if.ink | 6 | ultra-short |
| [ ] | us.ink | 6 | "us ink" |
| [ ] | go.ink | 6 | "go ink!" — action |
| [ ] | ok.ink | 6 | "ok ink" |
| [ ] | it.ink | 6 | "it ink" |
| [ ] | al.ink | 6 | "a link" |
| [ ] | nb.pub | 6 | "no bullshit pub" |
| [ ] | do.pub | 6 | "do publish" |
| [ ] | hi.pub | 6 | "hi pub" — greeting |
| [ ] | ox.pub | 6 | short |
| [ ] | ax.pub | 6 | short |
| [ ] | ex.pub | 6 | "ex pub" |
| [ ] | an.pub | 6 | short |
| [ ] | as.pub | 6 | short |
| [ ] | if.pub | 6 | short |
| [ ] | or.pub | 6 | short |
| [ ] | put.dev | 7 | HTTP PUT + developer |
| [ ] | new.ink | 7 | "new ink" = fresh writing |
| [ ] | jet.ink | 7 | "jet ink" = fast |
| [ ] | lit.ink | 7 | lit = fire/literature |
| [ ] | pen.ink | 7 | "pen and ink" |
| [ ] | own.ink | 7 | "own your ink" |
| [ ] | rad.ink | 7 | "rad ink" |
| [ ] | ace.ink | 7 | "ace ink" |
| [ ] | aim.ink | 7 | "aim ink" |
| [ ] | fin.ink | 7 | "fin ink" |
| [ ] | web.ink | 7 | "web ink" |
| [ ] | zen.ink | 7 | "zen ink" |
| [ ] | dip.ink | 7 | "dip in ink" |
| [ ] | fix.ink | 7 | "fix ink" |
| [ ] | zip.ink | 7 | "zip" = fast/compressed |
| [ ] | big.ink | 7 | "big ink" |
| [ ] | hot.pub | 7 | "hot pub" |
| [ ] | new.pub | 7 | "new pub" |
| [ ] | pub.lol | 7 | funny TLD |
| [ ] | ink.lol | 7 | funny TLD |
| [ ] | ink.xyz | 7 | xyz TLD |
| [ ] | dump.dev | 8 | data dump + dev |
| [ ] | no.press | 8 | "no press" / "no pressure" |
| [ ] | hot.press | 9 | "hot off the press" |
| [ ] | ink.press | 9 | ink + press |
| [ ] | pub.press | 9 | pub + press |
| [ ] | raw.press | 9 | raw + press |
| [ ] | zen.press | 9 | zen + press |
| [ ] | now.press | 9 | "press now" |
| [ ] | one.press | 9 | "one press" |
| [ ] | drop.press | 10 | "drop press" |
| [ ] | raw.page | 8 | raw + page |
| [ ] | pen.page | 8 | pen + page |

### For Sale (under $1,000)

| Fav | Domain | Price | Notes |
|---|---|---|---|
| [ ] | pub.ink | $248 | "publishing ink" — best value! |
| [ ] | set.ink | $472 | "set in ink" — permanent |
| [ ] | vim.ink | $488 | vim + ink |
| [ ] | pow.sh | $850 | "pow!" 6 chars |
| [ ] | run.pub | $708 | "run pub" — CLI + publish |

### For Sale (over $1,000 — dream list)

| Domain | Price | Notes |
|---|---|---|
| publ.ink | $2,790 | "pub link" — perfect compound |
| ink.cc | $3,500 | ink + cc |
| scop.es | $1,595 | "scopes" |
| wit.ink | $1,416 | "wit ink" |
| my.ink | $2,500 | "my ink" |
| say.ink | $5,500 | "say ink" |
| put.ink | $944 | "put ink" |
| pip.ink | $1,298 | "pip" (pipe) |
| nbs.xyz | $1,000 | "NBS" xyz |
| bull.sh | $49,999 | the dream — "bullsh*t" |
| pu.sh | $100,000 | "push" |
| pag.es | $60,000 | "pages" |

---

## Search Criteria

1. **Short is king** — 3-8 chars before the dot, ideally under 6
2. **Domain hacks preferred** — TLD completes a real word
3. **CLI/terminal feel** — should feel like a command
4. **No bullshit** — direct, punchy, no corporate fluff
5. **AI/publishing angle** — bonus if it nods to writing, publishing, or AI
6. **Easy to type** — remember, this is a CLI tool. No hyphens, no confusion
7. **Memorable URL** — the published pages will live at this domain, short = better
8. **Double meanings welcome** — clever wordplay that works on multiple levels

### Vibe Examples
- `telegra.ph` — the OG domain hack for publishing
- `publi.sh` — publish + shell
- `cl.ink` — click + link + ink
- `pos.to` — post to

---

## Archive — 709 domains checked (2026-03-18)

All .sh domain hacks (2-4 letter): **completely taken.** Every common English word that forms a word with .sh is registered.
All .st domain hacks (po.st, ca.st, fa.st, etc.): **completely taken.**
All .it 2-letter domains: **disallowed** by registry (Italy restricts short .it).
All .to 3-letter domains: **completely taken.**
All .ly common hacks: **completely taken.**
All .me common hacks: **completely taken.**
All .ai short domains: **taken or $15M+.**
All .run short domains: **taken.**
Most .dev short domains: **taken.**
.md (Moldova): has availability, but **hard to purchase** (not on Porkbun, limited registrars). Skipped.

Full results in `checked-domains.json` (709 entries).
