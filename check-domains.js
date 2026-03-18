#!/usr/bin/env node

/**
 * Domain availability checker for multiple TLDs
 * Uses Fastly Domain Research API (Domainr)
 *
 * Usage:
 *   echo "word1 word2 word3" | node check-domains.js
 *   node check-domains.js word1 word2 word3
 *   node check-domains.js --tld sh,dev word1 word2
 *   node check-domains.js --hack          # check domain hacks only (e.g. publi.sh)
 *   node check-domains.js --full word1    # check full domain as-is (e.g. "publi.sh")
 *
 * Output: markdown table rows ready to paste into domain-search.md
 *
 * Maintains checked-domains.json as a dedup database.
 */

const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

// Load .env file if it exists
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const [key, ...val] = line.split("=");
    if (key && val.length) process.env[key.trim()] = val.join("=").trim();
  }
}

const API_KEY = process.env.FASTLY_KEY;
if (!API_KEY) {
  console.error(
    "Error: FASTLY_KEY not set. Create a .env file with FASTLY_KEY=your_key",
  );
  process.exit(1);
}
const DB_FILE = path.join(__dirname, "checked-domains.json");
const DELAY_MS = 120; // polite delay between requests

// Default TLDs to check
const DEFAULT_TLDS = [
  "sh",
  "dev",
  "io",
  "is",
  "ink",
  "to",
  "it",
  "es",
  "pub",
  "page",
  "press",
  "run",
  "app",
  "ai",
  "co",
];

// Load or create the checked domains database
function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Check a single domain via Fastly API
function checkDomain(domain) {
  return new Promise((resolve, reject) => {
    const url = `https://api.fastly.com/domain-management/v1/tools/status?domain=${domain}`;
    const req = https.request(
      url,
      { headers: { "Fastly-Key": API_KEY } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(
              new Error(`Failed to parse response for ${domain}: ${data}`),
            );
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Parse status into human-readable form
function parseStatus(result) {
  const s = result.status || "";
  const offers = result.offers || [];

  if (
    s.includes("active") &&
    !s.includes("undelegated") &&
    !s.includes("inactive")
  ) {
    if (offers.length > 0) {
      const price = offers[0].price;
      return {
        status: "for sale",
        price: `$${Number(price).toLocaleString()}`,
      };
    }
    return { status: "taken", price: "—" };
  }

  if (s.includes("reserved")) {
    return { status: "reserved", price: "contact registry" };
  }

  if (s.includes("inactive")) {
    const isPremium = s.includes("premium");
    return {
      status: isPremium ? "available (premium)" : "available",
      price: isPremium ? "TBD" : "—",
    };
  }

  if (
    s.includes("undelegated") &&
    s.includes("active") &&
    !s.includes("inactive")
  ) {
    return { status: "unclear (verify)", price: "—" };
  }

  return { status: s, price: "—" };
}

// Format as markdown table row
function toMarkdownRow(domain, parsed) {
  return `| [ ] | ${domain} | ${parsed.status} | ${parsed.price} | |`;
}

// Parse arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let tlds = DEFAULT_TLDS;
  let hackOnly = false;
  let fullMode = false;
  const words = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tld" && args[i + 1]) {
      tlds = args[++i].split(",").map((t) => t.replace(/^\./, ""));
    } else if (args[i] === "--hack") {
      hackOnly = true;
    } else if (args[i] === "--full") {
      fullMode = true;
    } else if (!args[i].startsWith("--")) {
      words.push(args[i].trim().toLowerCase());
    }
  }

  return { tlds, hackOnly, fullMode, words };
}

async function main() {
  const db = loadDb();
  let { tlds, hackOnly, fullMode, words } = parseArgs();

  // Read from stdin if no words provided
  if (words.length === 0) {
    try {
      const input = fs.readFileSync("/dev/stdin", "utf8");
      words = input
        .split(/[\s,\n]+/)
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean);
    } catch {
      // no stdin
    }
  }

  if (words.length === 0) {
    console.error(
      "Usage: node check-domains.js [--tld sh,dev,io] [--hack] [--full] word1 word2 ...",
    );
    console.error("   or: echo 'word1 word2' | node check-domains.js");
    console.error("\nModes:");
    console.error("  (default)  Check word.tld for each TLD");
    console.error(
      "  --hack     Check domain hacks where TLD completes the word (e.g. publi.sh)",
    );
    console.error(
      "  --full     Check exact domains as given (e.g. 'publi.sh getl.ink')",
    );
    console.error("  --tld      Specify TLDs: --tld sh,dev,io");
    process.exit(1);
  }

  // Build list of domains to check
  let domains = [];

  if (fullMode) {
    // Check exact domains as provided
    domains = words.map((w) => w);
  } else if (hackOnly) {
    // Only check hack domains (word already contains the dot, like publi.sh)
    domains = words.map((w) => w);
  } else {
    // Standard mode: combine each word with each TLD
    for (const word of words) {
      for (const tld of tlds) {
        domains.push(`${word}.${tld}`);
      }
    }
  }

  // Deduplicate against database
  const newDomains = [];
  const skipped = [];
  for (const d of domains) {
    if (db[d]) {
      skipped.push(d);
    } else {
      newDomains.push(d);
    }
  }

  if (skipped.length > 0) {
    console.error(
      `\n⏭  Skipped ${skipped.length} already-checked: ${skipped.join(", ")}`,
    );
  }

  if (newDomains.length === 0) {
    console.error("\nAll domains already checked. Nothing to do.");
    process.exit(0);
  }

  console.error(`\nChecking ${newDomains.length} domains...\n`);

  // Results buckets
  const available = [];
  const taken = [];
  const forSale = [];

  for (const domain of newDomains) {
    try {
      const result = await checkDomain(domain);
      const parsed = parseStatus(result);

      // Save to database
      db[domain] = {
        domain,
        status: parsed.status,
        price: parsed.price,
        rawStatus: result.status,
        checkedAt: new Date().toISOString().split("T")[0],
      };

      if (parsed.status.includes("available")) {
        available.push({ domain, parsed });
      } else if (parsed.status === "for sale") {
        forSale.push({ domain, parsed });
      } else {
        taken.push({ domain, parsed });
      }

      process.stderr.write(`.`);
      await sleep(DELAY_MS);
    } catch (err) {
      console.error(`\n  Error checking ${domain}: ${err.message}`);
    }
  }

  // Print available
  if (available.length > 0) {
    console.log("\n### Available\n");
    console.log("| Fav | Domain | Status | Price | Notes |");
    console.log("|---|---|---|---|---|");
    for (const { domain, parsed } of available) {
      console.log(toMarkdownRow(domain, parsed));
    }
  }

  // Print for-sale
  if (forSale.length > 0) {
    console.log("\n### For Sale\n");
    console.log("| Fav | Domain | Status | Price | Notes |");
    console.log("|---|---|---|---|---|");
    for (const { domain, parsed } of forSale) {
      console.log(toMarkdownRow(domain, parsed));
    }
  }

  // Print taken
  if (taken.length > 0) {
    console.log("\n### Taken\n");
    console.log("| Domain | Status |");
    console.log("|---|---|");
    for (const { domain, parsed } of taken) {
      console.log(`| ${domain} | ${parsed.status} |`);
    }
  }

  // No results at all
  if (available.length === 0 && forSale.length === 0 && taken.length === 0) {
    console.log("\nNo results.");
  }

  // Save database
  saveDb(db);

  // Summary
  console.error(
    `\n\n✅ ${available.length} available, ${forSale.length} for sale, ${taken.length} taken`,
  );
  console.error(
    `📁 Database: ${Object.keys(db).length} total domains in ${DB_FILE}`,
  );
}

main().catch(console.error);
