// transNote ↔ Nostr bridge (Node, nostr-tools).
// The QML shell cannot speak websockets; this helper does relay I/O and
// exchanges plain JSON files with the plugin (same pattern as
// omarchy-agent-usage-update: background job writes files, UI watches them).
//
//   node sync.mjs ensure-key --key-file <path>
//     Creates ~/.local/share/transnote/nostr_key (nsec, mode 600) if missing.
//     Prints {"npub":...,"hex":...} on stdout.
//
//   node sync.mjs npub-to-hex --npub <npub>
//     Prints {"hex":...}. Use this to put a friend's npub into your
//     allow-list (allow-list stores 64-char hex, not npub).
//
//   node sync.mjs publish --key-file <path> --relays <csv> --in <publish.json> --recipients <csv>
//     Publishes ENCRYPTED (NIP-44 v2) note/comment events, one copy per
//     recipient. Prints {"results":[{"ref","id","ok"}]}.
//     publish.json: { notes:[{ref,d,title,body,updatedAt}],
//                     comments:[{ref,noteD,parentEventId,text}] }
//     --recipients: comma-separated hex or npub pubkeys. Your own pubkey is
//     always added automatically so a second device of yours can fetch.
//     Add --public ONLY to also publish the old legacy PUBLIC format
//     (opt-in, visible to everyone — not recommended).
//
//   node sync.mjs fetch --key-file <path> --relays <csv> --allow-list <csv> --since <unix> --limit <n> --out <f>
//     Queries relays for events addressed to YOU (p-tag = your pubkey),
//     decrypts them, keeps only authors on your allow-list (or yourself).
//     Prints {"notes":N,"pairs":M} and writes {notes:[...],pairs:[...]} to <f>.
//     Add --include-public to also read legacy PUBLIC events.
//
// Event design (encrypted, default):
//   note:    kind 30078, d=<note-id>:<recipientHex>, tags p=<recipientHex>,
//            t=transnote, enc=nip44-v2, client=transnote;
//            content=nip44(JSON {title,body}).
//   comment: kind 1, tags p=<recipientHex>, i=<note-id>, t=transnote,
//            enc=nip44-v2, client=transnote (+ e-tag when parent known);
//            content=nip44(JSON {text}).
// Relays see ciphertext + sender/recipient pubkeys only — NOT the text.
// Qualification happens on receipt: only allow-listed authors (or yourself)
// are merged. Removing someone stops FUTURE notes, it does not delete old
// ciphertext from relays.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip44, SimplePool } from "nostr-tools";

const APP_TAG = "transnote";
const NOTE_KIND = 30078;
const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const nxt = argv[i + 1];
      // An explicitly passed empty string ("") is a real value (e.g. an
      // empty allow-list), not a missing one — only treat a missing value
      // or the next flag as "no value" (which becomes "1" = flag present).
      out[k] = (nxt !== undefined && !String(nxt).startsWith("--")) ? argv[++i] : "1";
    }
  }
  return out;
}

function readSecret(keyFile) {
  const raw = readFileSync(keyFile, "utf8").trim();
  if (raw.startsWith("nsec1")) {
    const d = nip19.decode(raw);
    if (d.type !== "nsec") throw new Error("not an nsec");
    return d.data;
  }
  if (/^[0-9a-f]{64}$/i.test(raw)) return Uint8Array.from(Buffer.from(raw, "hex"));
  throw new Error("unrecognized key format");
}

function toHex(input) {
  const s = String(input || "").trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase();
  if (s.startsWith("npub1")) {
    const d = nip19.decode(s);
    if (d.type !== "npub") throw new Error("not an npub: " + s.slice(0, 12));
    return String(d.data).toLowerCase();
  }
  throw new Error("not a hex pubkey or npub: " + s.slice(0, 20));
}

function parsePubkeyList(csv) {
  const out = [];
  const seen = new Set();
  for (const part of String(csv || "").split(",")) {
    const s = part.trim();
    if (!s) continue;
    const hex = toHex(s);
    if (!seen.has(hex)) { seen.add(hex); out.push(hex); }
  }
  return out;
}

function encryptFor(senderSk, recipientHex, obj) {
  const conv = nip44.getConversationKey(senderSk, recipientHex);
  return nip44.encrypt(JSON.stringify(obj), conv);
}

function decryptFrom(mySk, authorHex, payload) {
  const conv = nip44.getConversationKey(mySk, String(authorHex).toLowerCase());
  return JSON.parse(nip44.decrypt(payload, conv));
}

function isAllowedAuthor(authorHex, allowHexSet, myHex) {
  const a = String(authorHex || "").toLowerCase();
  if (!a) return false;
  if (a === myHex) return true;
  return allowHexSet.has(a);
}

function cmdNpubToHex(a) {
  if (!a.npub) throw new Error("--npub required");
  console.log(JSON.stringify({ hex: toHex(a.npub) }));
}

function pubkeyHex(sk) {
  const pk = getPublicKey(sk);
  return (typeof pk === "string" ? pk : Buffer.from(pk).toString("hex")).toLowerCase();
}

function cmdEnsureKey(a) {
  const keyFile = a["key-file"];
  if (!keyFile) throw new Error("--key-file required");
  if (!existsSync(keyFile)) {
    mkdirSync(dirname(keyFile), { recursive: true });
    const sk = generateSecretKey();
    writeFileSync(keyFile, nip19.nsecEncode(sk) + "\n", { mode: 0o600 });
    try { chmodSync(keyFile, 0o600); } catch {}
  }
  const sk = readSecret(keyFile);
  const hex = pubkeyHex(sk);
  console.log(JSON.stringify({ npub: nip19.npubEncode(hex), hex }));
}

async function withPool(relays, fn) {
  const pool = new SimplePool();
  try {
    return await fn(pool);
  } finally {
    pool.close(relays);
  }
}

async function publishToRelays(pool, relays, ev) {
  const per = await Promise.allSettled(
    relays.map((r) =>
      Promise.race([
        pool.publish([r], ev),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000)),
      ]),
    ),
  );
  return per.some((p) => p.status === "fulfilled");
}

function toUnix(iso) {
  const t = Math.floor(new Date(iso).getTime() / 1000);
  return Number.isFinite(t) ? t : Math.floor(Date.now() / 1000);
}

async function cmdPublish(a) {
  const keyFile = a["key-file"];
  const relays = (a.relays || DEFAULT_RELAYS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const job = JSON.parse(readFileSync(a.in, "utf8"));
  if (!keyFile || !a.in) throw new Error("--key-file and --in required");
  const sk = readSecret(keyFile);
  const myHex = pubkeyHex(sk);
  // Encrypted by default: one ciphertext copy per recipient.
  // d-tag includes the recipient so NIP-33 replacement never overwrites a
  // different recipient's copy (kind+pubkey+d must stay unique per copy).
  let given = parsePubkeyList(a.recipients || "");
  const wantPublic = a.public !== undefined;
  if (given.length === 0 && !wantPublic) {
    throw new Error("--recipients required (or pass --public to opt into legacy PUBLIC publish)");
  }
  let recipients = given.slice();
  if (!recipients.includes(myHex)) recipients.push(myHex);
  const results = [];
  await withPool(relays, async (pool) => {
    for (const n of job.notes || []) {
      const noteId = String(n.d || "");
      if (!noteId) continue;
      for (const r of recipients) {
        const ev = finalizeEvent(
          {
            kind: NOTE_KIND,
            created_at: toUnix(n.updatedAt),
            tags: [
              ["d", noteId + ":" + r],
              ["p", r],
              ["t", APP_TAG],
              ["enc", "nip44-v2"],
              ["client", "transnote"],
            ],
            content: encryptFor(sk, r, { title: String(n.title || "Untitled").slice(0, 200), body: String(n.body || "") }),
          },
          sk,
        );
        const ok = await publishToRelays(pool, relays, ev);
        results.push({ ref: n.ref, to: r.slice(0, 8), id: ev.id, ok });
      }
      if (wantPublic) {
        const ev = finalizeEvent(
          {
            kind: NOTE_KIND,
            created_at: toUnix(n.updatedAt),
            tags: [
              ["d", noteId],
              ["t", APP_TAG],
              ["title", String(n.title || "Untitled").slice(0, 200)],
              ["client", "transnote"],
            ],
            content: String(n.body || ""),
          },
          sk,
        );
        const ok = await publishToRelays(pool, relays, ev);
        results.push({ ref: n.ref, to: "public", id: ev.id, ok });
      }
    }
    for (const c of job.comments || []) {
      for (const r of recipients) {
        const tags = [
          ["p", r],
          ["t", APP_TAG],
          ["i", String(c.noteD)],
          ["enc", "nip44-v2"],
          ["client", "transnote"],
        ];
        if (c.parentEventId) tags.unshift(["e", String(c.parentEventId), "", "root"]);
        const ev = finalizeEvent(
          { kind: 1, created_at: Math.floor(Date.now() / 1000), tags, content: encryptFor(sk, r, { text: String(c.text || "") }) },
          sk,
        );
        const ok = await publishToRelays(pool, relays, ev);
        results.push({ ref: c.ref, to: r.slice(0, 8), id: ev.id, ok });
      }
    }
  });
  console.log(JSON.stringify({ results }));
}

function tag(ev, name, idx = 0) {
  const t = (ev.tags || []).filter((x) => x[0] === name);
  return t.length > idx ? t[idx][1] || "" : "";
}

async function cmdFetch(a) {
  if (!a["key-file"]) throw new Error("--key-file required (needed to decrypt events addressed to you)");
  const mySk = readSecret(a["key-file"]);
  const myHex = pubkeyHex(mySk);
  const allowHexSet = new Set(parsePubkeyList(a["allow-list"] || ""));
  const relays = (a.relays || DEFAULT_RELAYS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const since = Number(a.since || 0);
  const limit = Math.min(500, Math.max(10, Number(a.limit || 200)));
  const includePublic = a["include-public"] !== undefined;
  const notes = [];
  const pairs = [];
  let newest = since;
  await withPool(relays, async (pool) => {
    // Only events addressed to me — public discovery of ciphertext,
    // private content. Sender must be allow-listed (or me).
    const filters = [
      { kinds: [NOTE_KIND], "#p": [myHex], "#t": [APP_TAG], limit },
      { kinds: [1], "#p": [myHex], "#t": [APP_TAG], limit },
    ];
    if (since > 0) filters.forEach((f) => { f.since = since; });
    if (includePublic) {
      filters.push({ kinds: [NOTE_KIND], "#t": [APP_TAG], limit });
      filters.push({ kinds: [1], "#t": [APP_TAG], limit });
    }
    const events = await pool.querySync(relays, filters);
    for (const ev of events) {
      if (typeof ev.created_at === "number" && ev.created_at > newest) newest = ev.created_at;
      const author = String(ev.pubkey || "").toLowerCase();
      if (!isAllowedAuthor(author, allowHexSet, myHex)) continue;
      const enc = tag(ev, "enc");
      if (enc === "nip44-v2") {
        let clear;
        try {
          clear = decryptFrom(mySk, author, String(ev.content || ""));
        } catch { continue; } // wrong key / garbage — skip
        if (ev.kind === NOTE_KIND) {
          const dFull = tag(ev, "d");
          const noteId = dFull.split(":")[0];
          if (!noteId) continue;
          if (String(tag(ev, "p")).toLowerCase() !== myHex) continue;
          notes.push({
            id: noteId,
            eventId: ev.id,
            title: String(clear.title || "Untitled"),
            body: String(clear.body || ""),
            authorHex: author,
            updatedAt: new Date((ev.created_at || 0) * 1000).toISOString(),
          });
        } else if (ev.kind === 1) {
          const noteD = tag(ev, "i").split(":")[0];
          if (!noteD || !clear.text) continue;
          pairs.push({
            noteId: noteD,
            comment: {
              id: ev.id,
              author,
              text: String(clear.text || ""),
              createdAt: new Date((ev.created_at || 0) * 1000).toISOString(),
            },
          });
        }
      } else if (includePublic) {
        // Legacy public format (opt-in only).
        if (ev.kind === NOTE_KIND) {
          const d = tag(ev, "d");
          if (!d || d.includes(":")) continue;
          notes.push({
            id: d,
            eventId: ev.id,
            title: tag(ev, "title") || "Untitled",
            body: String(ev.content || ""),
            authorHex: author,
            updatedAt: new Date((ev.created_at || 0) * 1000).toISOString(),
          });
        } else if (ev.kind === 1) {
          const noteD = tag(ev, "i");
          if (!noteD || !ev.content) continue;
          pairs.push({
            noteId: noteD,
            comment: {
              id: ev.id,
              author,
              text: String(ev.content || ""),
              createdAt: new Date((ev.created_at || 0) * 1000).toISOString(),
            },
          });
        }
      }
    }
  });
  if (a.out) {
    mkdirSync(dirname(a.out), { recursive: true });
    writeFileSync(a.out, JSON.stringify({ notes, pairs, newest }, null, 1) + "\n");
  }
  console.log(JSON.stringify({ notes: notes.length, pairs: pairs.length, newest }));
}

const [cmd, ...rest] = process.argv.slice(2);
const a = args(rest);
// Relay sockets often die noisily after close(); ignore late connection
// failures once the command itself has completed cleanly.
let finished = false;
process.on("unhandledRejection", (e) => {
  if (!finished) {
    console.error("transnote-nostr:", (e && e.message) || e);
    process.exitCode = 1;
  }
});
try {
  if (cmd === "ensure-key") cmdEnsureKey(a);
  else if (cmd === "npub-to-hex") cmdNpubToHex(a);
  else if (cmd === "publish") await cmdPublish(a);
  else if (cmd === "fetch") await cmdFetch(a);
  else throw new Error("usage: sync.mjs <ensure-key|npub-to-hex|publish|fetch> ...");
  finished = true;
} catch (e) {
  console.error("transnote-nostr:", e.message || e);
  process.exit(1);
}
