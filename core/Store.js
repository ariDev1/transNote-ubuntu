// TransNote store logic — pure JS, no Qt imports, Node-testable.
// Schema:
//   note: { id, title, body, author, createdAt, updatedAt, shared, comments: [], attachments: [] }
//   comment: { id, author, text, createdAt }
// Attachments are reserved for later: notes always carry `attachments: []`
// and peers ignore entries they do not understand.

function nowIso() {
  return new Date().toISOString()
}

function uid(prefix) {
  return (prefix || "id") + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 0xffffff).toString(36)
}

function normalizeText(value) {
  return String(value === undefined || value === null ? "" : value).trim()
}

// Parse the allowList setting, which may be an array, a comma-separated
// string, or empty.
function parseAllowList(value) {
  if (Array.isArray(value)) {
    return value.map(function (v) { return normalizeText(v) }).filter(function (v) { return v !== "" })
  }
  return String(value || "").split(",").map(function (v) { return normalizeText(v) }).filter(function (v) { return v !== "" })
}

// A peer is qualified when its device id is on the owner's allow-list.
// Allow-list entries may be device ids ("laptop") or Nostr pubkeys
// (64-char hex). npub values must be converted to hex first — see
// `node nostr/sync.mjs npub-to-hex --npub <npub>` — because this file
// stays dependency-free for QML.
function isHexPubkey(value) {
  return /^[0-9a-fA-F]{64}$/.test(normalizeText(value))
}

function normalizePubkey(value) {
  var s = normalizeText(value).toLowerCase()
  return isHexPubkey(s) ? s : ""
}

function isQualified(peerId, allowList) {
  var list = parseAllowList(allowList)
  var peer = normalizeText(peerId)
  if (peer === "") return false
  // Hex pubkeys compare case-insensitively; device ids compare exactly.
  if (isHexPubkey(peer)) {
    peer = peer.toLowerCase()
    for (var i = 0; i < list.length; i++) {
      if (normalizeText(list[i]).toLowerCase() === peer) return true
    }
    return false
  }
  return list.indexOf(peer) !== -1
}

function createNote(title, body, author) {
  var now = nowIso()
  return {
    id: uid("note"),
    title: normalizeText(title) || "Untitled",
    body: normalizeText(body),
    author: normalizeText(author) || "local",
    createdAt: now,
    updatedAt: now,
    shared: false,
    comments: [],
    attachments: [],
    // A fresh random tint per note (cycle back to plain any time).
    color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)]
  }
}

function sanitizeNote(raw) {
  if (!raw || typeof raw !== "object") return null
  var note = {
    id: normalizeText(raw.id),
    title: normalizeText(raw.title) || "Untitled",
    body: normalizeText(raw.body),
    author: normalizeText(raw.author) || "unknown",
    createdAt: normalizeText(raw.createdAt) || nowIso(),
    updatedAt: normalizeText(raw.updatedAt) || normalizeText(raw.createdAt) || nowIso(),
    shared: raw.shared === true,
    comments: [],
    attachments: [],
    color: sanitizeColor(raw.color)
  }
  if (note.id === "") return null
  var comments = Array.isArray(raw.comments) ? raw.comments : []
  for (var i = 0; i < comments.length; i++) {
    var c = sanitizeComment(comments[i])
    if (c) note.comments.push(c)
  }
  // Attachments are accepted only as strict records (see
  // sanitizeAttachment): unknown or oversized entries are dropped, so a
  // hostile snapshot cannot smuggle paths or giant blobs into the UI.
  var atts = Array.isArray(raw.attachments) ? raw.attachments : []
  for (var j = 0; j < atts.length; j++) {
    var a = sanitizeAttachment(atts[j])
    if (a) note.attachments.push(a)
  }
  return note
}

function sanitizeComment(raw) {
  if (!raw || typeof raw !== "object") return null
  var c = {
    id: normalizeText(raw.id),
    author: normalizeText(raw.author) || "unknown",
    text: normalizeText(raw.text),
    createdAt: normalizeText(raw.createdAt) || nowIso()
  }
  if (c.id === "" || c.text === "") return null
  return c
}

function createComment(author, text) {
  var t = normalizeText(text)
  if (t === "") return null
  return {
    id: uid("c"),
    author: normalizeText(author) || "local",
    text: t,
    createdAt: nowIso()
  }
}

function addComment(note, author, text) {
  if (!note) return null
  var c = createComment(author, text)
  if (!c) return null
  if (!Array.isArray(note.comments)) note.comments = []
  note.comments.push(c)
  note.updatedAt = nowIso()
  return c
}

// Only the note author (owner) flips the shared flag; peers cannot
// re-share someone else's note.
function setShared(note, shared, requester) {
  if (!note) return false
  if (normalizeText(requester) !== "" && normalizeText(requester) !== note.author) return false
  note.shared = shared === true
  note.updatedAt = nowIso()
  return true
}

// Same ownership for the tint: only the author recolors (it syncs to
// everyone). Unknown keys are rejected, "" clears back to plain.
function setColor(note, color, requester) {
  if (!note) return false
  if (normalizeText(requester) !== "" && normalizeText(requester) !== note.author) return false
  note.color = sanitizeColor(color)
  note.updatedAt = nowIso()
  return true
}

// Notes visible to `viewerId`: own notes always, plus shared notes whose
// author qualifies the viewer OR whose owner (me) qualified the author.
// `myId` is this device; `allowList` is my allow-list.
function visibleNotes(notes, viewerId, myId, allowList) {
  var list = Array.isArray(notes) ? notes : []
  var me = normalizeText(myId)
  var viewer = normalizeText(viewerId)
  return list.filter(function (n) {
    if (!n) return false
    if (viewer === me) return true
    if (n.shared !== true) return false
    // My shared notes: viewer must be qualified by me.
    if (n.author === me) return isQualified(viewer, allowList)
    // A peer's shared note: I must have qualified its author.
    return isQualified(n.author, allowList)
  })
}

// Merge an incoming peer snapshot into local notes.
// Rules: union by note id, last-updated wins for note fields, union comments
// by id. Incoming notes are only accepted when they are shared AND their
// author is qualified by my allow-list — except notes authored by myId
// itself, which is how a second device of the same user syncs.
// Incoming comments on my notes are only accepted from qualified peers
// (or myself).
function mergeNotes(localNotes, incomingNotes, myAllowList, myId) {
  var me = normalizeText(myId)
  var allowed = function (author) {
    var a = normalizeText(author)
    if (a !== "" && a === me) return true
    return isQualified(a, myAllowList)
  }
  var local = (Array.isArray(localNotes) ? localNotes : []).map(sanitizeNote).filter(function (n) { return !!n })
  var incoming = (Array.isArray(incomingNotes) ? incomingNotes : []).map(sanitizeNote).filter(function (n) { return !!n })
  var byId = {}
  local.forEach(function (n) { byId[n.id] = n })

  incoming.forEach(function (peer) {
    if (peer.shared !== true) return
    if (!allowed(peer.author)) return
    var existing = byId[peer.id]
    if (!existing) {
      byId[peer.id] = peer
      return
    }
    // Last write wins for the note envelope; comments merge by id so no
    // comment is ever lost by an older envelope overwriting a newer one.
    var knownComments = {}
    existing.comments.forEach(function (c) { knownComments[c.id] = true })
    peer.comments.forEach(function (c) {
      if (!knownComments[c.id]) {
        // Only accept peer comments from qualified authors (or myself).
        if (allowed(c.author) || c.author === peer.author) {
          existing.comments.push(c)
          knownComments[c.id] = true
        }
      }
    })
    if (peer.updatedAt >= existing.updatedAt) {
      existing.title = peer.title
      existing.body = peer.body
      existing.updatedAt = peer.updatedAt
      existing.shared = peer.shared
      existing.attachments = peer.attachments
      existing.color = peer.color
    }
    existing.comments.sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1 })
  })

  var out = Object.keys(byId).map(function (k) { return byId[k] })
  out.sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1 })
  return out
}

function sortNotes(notes) {
  var out = (Array.isArray(notes) ? notes.slice() : [])
  out.sort(function (a, b) { return (a.updatedAt || "") < (b.updatedAt || "") ? 1 : -1 })
  return out
}

// Outbox entries: my comments on peers' notes, published in my snapshot as
// { noteId, comment } pairs so the note author can merge them in.
// Sanitize to a clean [{ noteId, comment }] array.
function sanitizeOutbox(raw) {
  var out = []
  var arr = Array.isArray(raw) ? raw : []
  for (var i = 0; i < arr.length; i++) {
    var entry = arr[i]
    if (!entry || typeof entry !== "object") continue
    var noteId = normalizeText(entry.noteId)
    var c = sanitizeComment(entry.comment)
    if (noteId === "" || !c) continue
    out.push({ noteId: noteId, comment: c })
  }
  return out
}

// Merge incoming { noteId, comment } pairs into a { noteId: [comment] } map.
// Only comments from qualified authors (or myself) are accepted; union by
// comment id so repeats across snapshots never duplicate.
function mergeForeignComments(existingMap, incomingPairs, myAllowList, myId) {
  var me = normalizeText(myId)
  var merged = {}
  var src = existingMap && typeof existingMap === "object" ? existingMap : {}
  Object.keys(src).forEach(function (k) {
    merged[k] = (Array.isArray(src[k]) ? src[k] : []).map(sanitizeComment).filter(function (c) { return !!c })
  })
  sanitizeOutbox(incomingPairs).forEach(function (entry) {
    var author = normalizeText(entry.comment.author)
    if (author === "" || !(author === me || isQualified(author, myAllowList))) return
    if (!merged[entry.noteId]) merged[entry.noteId] = []
    var known = false
    for (var i = 0; i < merged[entry.noteId].length; i++) {
      if (merged[entry.noteId][i].id === entry.comment.id) { known = true; break }
    }
    if (!known) merged[entry.noteId].push(entry.comment)
    merged[entry.noteId].sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1 })
  })
  return merged
}

// Drop outbox entries whose note is gone from both local and peer notes,
// so deleted peer notes don't accumulate stale comments forever.
function pruneOutbox(outbox, localNotes, peerNotes) {
  var alive = {}
  ;(Array.isArray(localNotes) ? localNotes : []).forEach(function (n) { if (n) alive[n.id] = true })
  ;(Array.isArray(peerNotes) ? peerNotes : []).forEach(function (n) { if (n) alive[n.id] = true })
  return sanitizeOutbox(outbox).filter(function (entry) { return !!alive[entry.noteId] })
}

// Hex recipients among the allow-list — the only entries usable for
// encrypted Nostr publish. Device ids are for folder sync and ignored here.
function hexRecipients(allowList) {
  return parseAllowList(allowList).filter(function (v) { return isHexPubkey(v) }).map(function (v) { return normalizePubkey(v) })
}

// Short preview of a note body for the collapsed list view. Returns
// { text, truncated }. Plain truncation (no QML maximumLineCount) so a long
// note can never overflow its delegate and paint over the footer.
function previewBody(body, maxLines, maxChars) {
  var src = String(body === undefined || body === null ? "" : body)
  var lines = maxLines === undefined ? 6 : maxLines
  var chars = maxChars === undefined ? 600 : maxChars
  if (src === "") return { text: "", truncated: false }
  var parts = src.split("\n")
  var cutByLines = parts.length > lines
  var text = parts.slice(0, lines).join("\n")
  var cutByChars = false
  if (text.length > chars) {
    var cut = text.slice(0, chars)
    var sp = cut.lastIndexOf(" ")
    text = (sp > chars * 0.5 ? cut.slice(0, sp) : cut) + "…"
    cutByChars = true
  } else if (cutByLines) {
    text = text + "…"
  }
  return { text: text, truncated: cutByLines || cutByChars }
}
// Note tint keys (UI maps them to translucent theme-safe colors).
// Stored on the note and synced like any other field.
var NOTE_COLORS = ["red", "orange", "yellow", "green", "blue", "violet"]

function sanitizeColor(value) {
  var s = normalizeText(value).toLowerCase()
  return NOTE_COLORS.indexOf(s) !== -1 ? s : ""
}
// Plain-text rendering of a note for clipboard copy: body only, never the
// headline (titles are labels, not content).
function copyText(note) {
  if (!note || typeof note !== "object") return ""
  return String(note.body === undefined || note.body === null ? "" : note.body).replace(/\r\n/g, "\n")
}
// Sync-artifact filenames that must never be treated as peer snapshots:
// Syncthing conflict copies (`<id>.sync-conflict-<date>.json`), Dropbox
// conflict copies (`<id> (conflicted copy …).json`), and hidden files.
// Without this, a conflict file would impersonate a peer device (it ends
// in .json) and could resurrect deleted notes on merge.
function isSyncArtifact(name) {
  var s = String(name === undefined || name === null ? "" : name)
  if (s === "") return true
  var base = s.split("/").pop()
  if (base.charAt(0) === ".") return true
  var lower = base.toLowerCase()
  if (lower.indexOf(".sync-conflict-") !== -1) return true
  if (lower.indexOf("conflicted copy") !== -1) return true
  if (lower.slice(-4) === ".tmp" || lower.slice(-4) === ".bak") return true
  return false
}
// Split a note body into [{ type: "text"|"code", lang, content }] on
// triple-backtick fences. The fence remainder is the language tag (trimmed,
// max 20 chars). An unclosed fence runs to the end. Fences indented 4+
// spaces are plain text. Empty segments are dropped.
function parseSegments(body) {
  var src = String(body === undefined || body === null ? "" : body).replace(/\r\n/g, "\n")
  if (src === "") return []
  var lines = src.split("\n")
  var segs = []
  var buf = []
  var inCode = false
  var lang = ""
  function fenceOf(line) {
    var t = String(line).replace(/^\s{0,3}/, "")
    if (t.slice(0, 3) !== "```") return null
    return t.slice(3).trim().slice(0, 20)
  }
  function flush(type, content) {
    if (content !== "") segs.push({ type: type, lang: type === "code" ? lang : "", content: content })
  }
  for (var i = 0; i < lines.length; i++) {
    var f = fenceOf(lines[i])
    if (f !== null && !inCode) {
      flush("text", buf.join("\n"))
      buf = []
      inCode = true
      lang = f
    } else if (f !== null && inCode) {
      flush("code", buf.join("\n"))
      buf = []
      inCode = false
      lang = ""
    } else {
      buf.push(lines[i])
    }
  }
  flush(inCode ? "code" : "text", buf.join("\n"))
  return segs
}
// Attachments (MVP: folder-sync sidecars, metadata inline in the note).
// Per-file cap keeps every 15s sync snappy; bytes live in
// <syncDir>/.attachments/<noteId>/<attId>-<name>, never in JSON.
var MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

// Basename only, traversal-proof: strips directories, whitelists chars,
// never leading-dot, max 100 chars. "" = unusable, caller must reject.
function sanitizeFileName(name) {
  var s = String(name === undefined || name === null ? "" : name)
  s = s.split("/").pop().split("\\").pop()
  s = s.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 100)
  if (s === "" || s === "." || s === "..") return ""
  return s
}

function attachmentKindFor(name) {
  var ext = String(name || "").split(".").pop().toLowerCase()
  var images = { png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, bmp: 1, svg: 1 }
  var texts = {
    txt: 1, md: 1, markdown: 1, log: 1, json: 1, js: 1, mjs: 1, ts: 1,
    qml: 1, sh: 1, py: 1, rb: 1, java: 1, c: 1, h: 1, cpp: 1, hpp: 1,
    rs: 1, go: 1, css: 1, html: 1, htm: 1, xml: 1, yml: 1, yaml: 1,
    toml: 1, ini: 1, cfg: 1, conf: 1, csv: 1, tsv: 1, diff: 1, patch: 1,
    tex: 1, vue: 1
  }
  if (images[ext]) return "image"
  if (texts[ext]) return "text"
  return "file"
}

function mimeForName(name) {
  var ext = String(name || "").split(".").pop().toLowerCase()
  if (attachmentKindFor(name) === "image") return "image/" + (ext === "svg" ? "svg+xml" : (ext === "jpg" ? "jpeg" : ext))
  if (attachmentKindFor(name) === "text") return "text/plain"
  return "application/octet-stream"
}

// Strict receipt validation: recomputes mime/kind, never trusts them.
// Returns a clean record or null.
function sanitizeAttachment(raw) {
  if (!raw || typeof raw !== "object") return null
  var id = normalizeText(raw.id)
  var name = sanitizeFileName(raw.name)
  var size = Math.floor(Number(raw.size))
  var sha = normalizeText(raw.sha256).toLowerCase()
  if (id === "" || name === "") return null
  if (!isFinite(size) || size < 0 || size > MAX_ATTACHMENT_BYTES) return null
  if (!/^[0-9a-f]{64}$/.test(sha)) return null
  return { id: id, name: name, size: size, sha256: sha, mime: mimeForName(name), kind: attachmentKindFor(name) }
}

// Local construction after hashing. Null when unusable (caller messages).
// Pass the pre-generated attId so concurrent panel runs can match their
// own completion; falls back to a fresh uid when omitted.
function createAttachment(name, size, sha256, id) {
  var clean = sanitizeFileName(name)
  var s = Math.floor(Number(size))
  var sha = normalizeText(sha256).toLowerCase()
  var attId = normalizeText(id) !== "" ? normalizeText(id) : uid("att")
  if (clean === "" || !isFinite(s) || s < 0 || s > MAX_ATTACHMENT_BYTES) return null
  if (!/^[0-9a-f]{64}$/.test(sha)) return null
  return { id: attId, name: clean, size: s, sha256: sha, mime: mimeForName(clean), kind: attachmentKindFor(clean) }
}

// Extensions the panel will save but never Open (save-only + notice).
function isRiskyExecutable(name) {
  var ext = String(name || "").split(".").pop().toLowerCase()
  return { sh: 1, exe: 1, bin: 1, run: 1, appimage: 1, deb: 1, rpm: 1, bat: 1, cmd: 1, ps1: 1, com: 1, scr: 1, msi: 1 }[ext] === 1
}
// Friends file (managed in the panel UI, no terminal needed):
// { version: 1, friends: [{ hex, name }] }. Accepts the raw file text,
// the parsed object, or an already-clean array (idempotent).
function sanitizeFriends(raw) {
  var out = []
  try {
    var parsed = typeof raw === "string" ? JSON.parse(raw || "") : (raw || {})
    var arr = parsed && Array.isArray(parsed.friends) ? parsed.friends : (Array.isArray(parsed) ? parsed : [])
    var seen = {}
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i]
      if (!e || typeof e !== "object") continue
      var hex = normalizePubkey(e.hex || e.pubkey)
      if (hex === "" || seen[hex]) continue
      seen[hex] = true
      var name = normalizeText(e.name).slice(0, 40)
      out.push({ hex: hex, name: name || hex.slice(0, 8) })
    }
  } catch (e) { /* ignore bad friends file */ }
  return out
}

// Everyone allowed on the internet path: hex entries from the allow-list
// setting plus friends added in the panel UI. De-duplicated hex array.
function effectiveNostrAllow(allowList, friends) {
  var seen = {}
  var out = []
  hexRecipients(allowList).forEach(function (h) { if (!seen[h]) { seen[h] = true; out.push(h) } })
  sanitizeFriends(friends).forEach(function (f) { if (!seen[f.hex]) { seen[f.hex] = true; out.push(f.hex) } })
  return out
}

// Convert `fetch --out` JSON into internal { notes, pairs }.
// fetch output: { notes:[{id,title,body,authorHex,updatedAt,eventId}],
//                 pairs:[{noteId,comment:{id,author,text,createdAt}}] }.
// Returned notes are marked shared=true and carry the hex author so the
// normal allow-list filter applies. Unknown authors are dropped unless
// they are myHex itself (second device of the same user).
function sanitizeNostrFetch(raw, allowList, myHex) {
  var notes = []
  var pairs = []
  try {
    var parsed = typeof raw === "string" ? JSON.parse(raw || "") : (raw || {})
    var me = normalizePubkey(myHex)
    var arr = parsed && Array.isArray(parsed.notes) ? parsed.notes : []
    for (var i = 0; i < arr.length; i++) {
      var n = arr[i]
      if (!n || typeof n !== "object") continue
      var authorHex = normalizePubkey(n.authorHex || n.author)
      if (authorHex === "") continue
      if (!(authorHex === me || isQualified(authorHex, allowList))) continue
      var clean = sanitizeNote({
        id: n.id,
        title: n.title,
        body: n.body,
        author: authorHex,
        createdAt: n.updatedAt || n.createdAt,
        updatedAt: n.updatedAt,
        shared: true,
        comments: [],
        attachments: []
      })
      if (clean) notes.push(clean)
    }
    var rawPairs = parsed && Array.isArray(parsed.pairs) ? parsed.pairs : []
    for (var j = 0; j < rawPairs.length; j++) {
      var e = rawPairs[j]
      if (!e || typeof e !== "object") continue
      var c = e.comment
      if (!c || typeof c !== "object") continue
      var ca = normalizePubkey(c.author)
      if (ca === "") continue
      if (!(ca === me || isQualified(ca, allowList))) continue
      var sc = sanitizeComment({ id: c.id, author: ca, text: c.text, createdAt: c.createdAt })
      var noteId = normalizeText(e.noteId)
      if (noteId === "" || !sc) continue
      pairs.push({ noteId: noteId, comment: sc })
    }
  } catch (e) { /* ignore bad fetch file */ }
  return { notes: notes, pairs: pairs }
}

// Build publish.json for `sync.mjs publish` from shared local notes +
// outbox comments. sync.mjs encrypts one copy per --recipients pubkey.
function buildNostrPublish(localNotes, outbox) {
  var notes = []
  var comments = []
  ;(Array.isArray(localNotes) ? localNotes : []).forEach(function (n) {
    if (!n || n.shared !== true) return
    var clean = sanitizeNote(n)
    if (!clean) return
    notes.push({ ref: clean.id, d: clean.id, title: clean.title, body: clean.body, updatedAt: clean.updatedAt })
  })
  sanitizeOutbox(outbox).forEach(function (entry) {
    comments.push({ ref: entry.comment.id, noteD: entry.noteId, text: entry.comment.text })
  })
  return { notes: notes, comments: comments }
}

if (typeof module !== "undefined") {
  module.exports = {
    nowIso: nowIso,
    uid: uid,
    normalizeText: normalizeText,
    parseAllowList: parseAllowList,
    isHexPubkey: isHexPubkey,
    normalizePubkey: normalizePubkey,
    isQualified: isQualified,
    createNote: createNote,
    createComment: createComment,
    sanitizeNote: sanitizeNote,
    sanitizeComment: sanitizeComment,
    sanitizeOutbox: sanitizeOutbox,
    mergeForeignComments: mergeForeignComments,
    pruneOutbox: pruneOutbox,
    previewBody: previewBody,
    parseSegments: parseSegments,
    sanitizeAttachment: sanitizeAttachment,
    createAttachment: createAttachment,
    sanitizeFileName: sanitizeFileName,
    attachmentKindFor: attachmentKindFor,
    mimeForName: mimeForName,
    isRiskyExecutable: isRiskyExecutable,
    MAX_ATTACHMENT_BYTES: MAX_ATTACHMENT_BYTES,
    copyText: copyText,
    isSyncArtifact: isSyncArtifact,
    hexRecipients: hexRecipients,
    sanitizeFriends: sanitizeFriends,
    effectiveNostrAllow: effectiveNostrAllow,
    sanitizeNostrFetch: sanitizeNostrFetch,
    buildNostrPublish: buildNostrPublish,
    addComment: addComment,
    setShared: setShared,
    setColor: setColor,
    sanitizeColor: sanitizeColor,
    NOTE_COLORS: NOTE_COLORS,
    visibleNotes: visibleNotes,
    mergeNotes: mergeNotes,
    sortNotes: sortNotes
  }
}
