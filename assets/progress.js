// Course progress store — the one place anything durable is written.
//
// Load this BEFORE kana-drill.js or quiz.js; both depend on it. build-site.py
// fails the build if a page includes either without it.
//
// Why this exists: the drill and the quizzes each used to own their storage —
// and the quizzes owned none at all, so every lesson result vanished when the
// page closed. There was no way to answer "how did this week go", and no
// history, so an earlier run's raw data could only ever be recovered from
// whatever prose summary happened to be written down at the time. That has
// already cost us one irrecoverable dataset.
//
// Shape:
//   { v, createdAt, exportedAt,
//     kana:    { "あ": {n, ok, streak, lapses, last, masteredAt, relapses} },
//     lessons: { "0007-the-fu-trap": {title, opened, completed, right, total,
//                                     missed: [...], at} },
//     sessions:[ {t, kind, page, right, total, solid, missed:[...]} ] }
//
// sessions is capped — per-kana aggregates are kept forever because they're
// small and they're the actual state; session rows are a rolling window so the
// export stays a thing a person can paste.

(function () {
  var KEY = "nihongo-v1";
  var LEGACY_KANA = "kana-drill-v1";
  var MAX_SESSIONS = 30;
  var V = 1;

  function now() { return Date.now(); }

  function pct(n, d) { return d ? Math.round((n / d) * 100) + "%" : "—"; }

  function blank() {
    return { v: V, createdAt: now(), exportedAt: 0, kana: {}, lessons: {}, sessions: [] };
  }

  // localStorage can throw outright (sandboxed frames, storage disabled), not
  // just return null. Everything below has to survive that without the caller
  // having to care.
  function writable() {
    try {
      localStorage.setItem(KEY + "-probe", "1");
      var ok = localStorage.getItem(KEY + "-probe") === "1";
      localStorage.removeItem(KEY + "-probe");
      return ok;
    } catch (e) { return false; }
  }

  var memory = null;   // stands in when storage is unavailable, so a session
                       // still behaves correctly even if it can't outlive itself

  function read() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.v === V) return parsed;
      } catch (e) { /* fall through to a rebuild rather than lose the session */ }
    }
    if (memory) return memory;
    return migrate();
  }

  // One-time import of the drill's old private key. Kept non-destructive: the
  // legacy key is left in place, so a bad migration can't take his history with
  // it.
  function migrate() {
    var st = blank();
    try {
      var old = JSON.parse(localStorage.getItem(LEGACY_KANA) || "null");
      if (old && typeof old === "object") {
        Object.keys(old).forEach(function (k) {
          var s = old[k];
          if (!s || typeof s.n !== "number") return;
          st.kana[k] = {
            n: s.n, ok: s.ok || 0, streak: s.streak || 0,
            lapses: s.lapses || 0, last: s.last || 0,
            masteredAt: s.streak >= 3 ? now() : 0, relapses: 0
          };
        });
        st.migratedFrom = LEGACY_KANA;
      }
    } catch (e) {}
    write(st);
    return st;
  }

  function write(st) {
    memory = st;
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
    return st;
  }

  // The export is something he pastes from a phone, so its size is a feature.
  // Stored verbatim, a full-92 state is ~15KB — and almost all of that is the
  // same eight JSON keys repeated 92 times. Positional arrays plus
  // second-resolution timestamps cut it to roughly a third.
  //
  // Field order is load-bearing: append only, never reorder or remove, or old
  // exports decode into the wrong columns. `last` is a latency in ms, not a
  // timestamp — it must not be rescaled.
  var KANA_ORDER = ["n", "ok", "streak", "lapses", "last", "masteredAt",
                    "relapses", "lastRelapseAt", "wrong"];
  var KANA_TS = { masteredAt: 1, lastRelapseAt: 1 };
  // `wrong` is a tally of what he actually TYPED when he missed this kana,
  // encoded "me:4|nu:2". Record 0008's best finding — that his errors are
  // attractor answers, not pairs — came from counting typed answers by hand off
  // a chat paste. Nothing stored them, so by record 0011 his worst kana (ま, 24
  // misses in 62 attempts) could not be diagnosed at all. Now it can.
  var KANA_STR = { wrong: 1 };
  var WRONG_KEPT = 3;   // top-N by count; the tail is noise and costs export bytes
  var SESSION_ORDER = ["t", "kind", "page", "right", "total", "solid", "missed",
                       "chose"];
  var SESSIONS_WITH_DETAIL = 10;

  function normalize(kana) {
    Object.keys(kana).forEach(function (c) {
      var s = kana[c];
      KANA_ORDER.forEach(function (f) { s[f] = s[f] || (KANA_STR[f] ? {} : 0); });
    });
    return kana;
  }

  // {me:4, nu:2} <-> "me:4|nu:2". Kept as a string in the export so it costs one
  // short field per kana instead of a nested object per kana.
  function encodeWrong(o) {
    return Object.keys(o || {})
      .sort(function (a, b) { return o[b] - o[a]; })
      .slice(0, WRONG_KEPT)
      .map(function (k) { return k + ":" + o[k]; })
      .join("|");
  }

  function decodeWrong(v) {
    var o = {};
    if (typeof v !== "string" || !v) return o;
    v.split("|").forEach(function (part) {
      var bits = part.split(":");
      if (bits.length === 2 && bits[0]) o[bits[0]] = +bits[1] || 0;
    });
    return o;
  }

  function encodeKana(s) {
    var row = KANA_ORDER.map(function (f) {
      if (KANA_STR[f]) return encodeWrong(s[f]);
      var v = s[f] || 0;
      return KANA_TS[f] ? Math.floor(v / 1000) : v;
    });
    while (row.length && !row[row.length - 1]) row.pop();   // trim trailing zeros
    return row;
  }

  function decodeKana(row) {
    var s = {};
    KANA_ORDER.forEach(function (f, i) {
      var v = row[i];
      if (KANA_STR[f]) s[f] = decodeWrong(v);
      else s[f] = KANA_TS[f] ? (v || 0) * 1000 : (v || 0);
    });
    return s;
  }

  function compact(st) {
    var out = { v: st.v, createdAt: st.createdAt, exportedAt: st.exportedAt,
                k: {}, lessons: st.lessons, s: [] };
    if (st.migratedFrom) out.migratedFrom = st.migratedFrom;
    Object.keys(st.kana).forEach(function (c) { out.k[c] = encodeKana(st.kana[c]); });
    // Old sessions keep their score but lose the per-card detail — a delta only
    // reads the aggregate, and the kana-level truth lives in `k` regardless.
    var cut = st.sessions.length - SESSIONS_WITH_DETAIL;
    out.s = st.sessions.map(function (sess, i) {
      var row = SESSION_ORDER.map(function (f) {
        if (f === "t") return Math.floor((sess.t || 0) / 1000);
        if (f === "missed") return i >= cut ? (sess.missed || []) : 0;
        if (f === "chose") return i >= cut ? (sess.chose || []) : 0;
        return sess[f] || 0;
      });
      while (row.length && !row[row.length - 1]) row.pop();
      return row;
    });
    return out;
  }

  function expand(raw) {
    // Accepts either the compact export or a raw internal snapshot, so a state
    // blob copied out of devtools still restores.
    if (raw.kana && raw.sessions) return raw;
    var st = { v: raw.v, createdAt: raw.createdAt || now(),
               exportedAt: raw.exportedAt || 0,
               kana: {}, lessons: raw.lessons || {}, sessions: [] };
    if (raw.migratedFrom) st.migratedFrom = raw.migratedFrom;
    Object.keys(raw.k || {}).forEach(function (c) { st.kana[c] = decodeKana(raw.k[c]); });
    (raw.s || []).forEach(function (row) {
      var sess = {};
      SESSION_ORDER.forEach(function (f, i) {
        var v = row[i];
        if (f === "t") sess.t = (v || 0) * 1000;
        else if (f === "missed") sess.missed = Array.isArray(v) ? v : [];
        else if (f === "chose") sess.chose = Array.isArray(v) ? v : [];
        else sess[f] = v || 0;
      });
      st.sessions.push(sess);
    });
    return st;
  }

  function trim(st) {
    if (st.sessions.length > MAX_SESSIONS) {
      st.sessions = st.sessions.slice(st.sessions.length - MAX_SESSIONS);
    }
    return st;
  }

  window.Progress = {
    KEY: KEY,
    writable: writable,
    all: read,

    // --- kana -------------------------------------------------------------
    // Normalised on the way out. The export strips zero-valued fields to keep
    // the paste small, so anything restored can legitimately arrive with fields
    // missing — and `undefined + 1` is NaN, which would quietly poison a streak
    // forever. Fill the shape here, once, rather than trusting every reader.
    kana: function () { return normalize(read().kana); },

    saveKana: function (kana) {
      var st = read();
      st.kana = kana;
      write(st);
    },

    // Called by the drill on every answer, so mastery/relapse history is
    // recorded once, here, instead of being re-derived by each caller.
    // Called by the drill on a miss, with what he actually typed.
    noteWrong: function (slot, typed) {
      if (!typed) return slot;
      if (!slot.wrong || typeof slot.wrong !== "object") slot.wrong = {};
      slot.wrong[typed] = (slot.wrong[typed] || 0) + 1;
      return slot;
    },

    noteKana: function (k, slot, wasMastered) {
      if (slot.streak >= 3 && !slot.masteredAt) slot.masteredAt = now();
      // Losing a kana you had genuinely mastered is the single most useful
      // teaching signal there is, and nothing used to record it.
      if (wasMastered && slot.streak === 0) {
        slot.relapses = (slot.relapses || 0) + 1;
        slot.lastRelapseAt = now();
      }
      return slot;
    },

    // --- lessons ----------------------------------------------------------
    lessonId: function () {
      var f = location.pathname.split("/").pop() || "index.html";
      return f.replace(/\.html$/, "");
    },

    openLesson: function (id, title) {
      var st = read();
      var l = st.lessons[id] || (st.lessons[id] = { title: title, opened: 0, completed: 0 });
      l.title = title || l.title;
      l.opened = (l.opened || 0) + 1;
      l.lastOpenedAt = now();
      write(st);
    },

    completeLesson: function (id, title, right, total, missed, chose) {
      var st = read();
      var l = st.lessons[id] || (st.lessons[id] = { title: title, opened: 1 });
      l.title = title || l.title;
      l.completed = (l.completed || 0) + 1;
      l.right = right; l.total = total; l.missed = missed; l.at = now();
      st.sessions.push({
        t: now(), kind: "quiz", page: id, right: right, total: total,
        missed: missed, chose: chose || []
      });
      write(trim(st));
    },

    noteDrill: function (kind, page, right, total, solid, missed) {
      var st = read();
      st.sessions.push({
        t: now(), kind: kind, page: page,
        right: right, total: total, solid: solid, missed: missed
      });
      write(trim(st));
    },

    // --- the report -------------------------------------------------------
    //
    // Two audiences in one blob. The prose is what he skims to confirm it
    // captured the right week; the JSON is what actually gets parsed and
    // committed to the repo. Leading with the delta is the point — it's what
    // makes pasting weekly viable instead of pasting after every session.
    report: function (total) {
      var st = read();
      normalize(st.kana);   // a restored export can arrive with fields trimmed
      var since = st.exportedAt || 0;
      var L = [];
      var kanaKeys = Object.keys(st.kana);
      var mastered = kanaKeys.filter(function (k) { return st.kana[k].streak >= 3; });
      var leeches = kanaKeys.filter(function (k) {
        return st.kana[k].lapses >= 2 && st.kana[k].streak < 3;
      });

      L.push("Nihongo — progress export");
      L.push(since ? "Since last paste: " + new Date(since).toISOString().slice(0, 10)
                   : "First export — everything below is cumulative.");
      L.push("");

      var fresh = st.sessions.filter(function (s) { return s.t > since; });
      L.push("NEW SINCE LAST PASTE");
      if (!fresh.length) {
        L.push("  (nothing — no drills or lessons since the last export)");
      } else {
        var drills = fresh.filter(function (s) { return s.kind !== "quiz"; });
        if (drills.length) {
          var cards = 0, right = 0, solid = 0;
          drills.forEach(function (s) {
            cards += s.total || 0; right += s.right || 0; solid += s.solid || 0;
          });
          L.push("  Drill sessions: " + drills.length + " (" + cards + " cards, " +
            pct(right, cards) + " correct, " + pct(solid, cards) + " solid)");
        }
        fresh.filter(function (s) { return s.kind === "quiz"; }).forEach(function (s) {
          L.push("  Lesson completed: " + s.page + " — " + s.right + "/" + s.total +
            (s.missed && s.missed.length ? "  missed " + s.missed.join(", ") : ""));
        });
        // masteredAt is a permanent stamp; `mastered` is streak >= 3 right now.
        // A slow-but-correct answer caps streak at 1, so a kana can hold the
        // stamp while no longer counting — and the old line reported フ as newly
        // mastered four lines above "Mastered: 4/92", in a paste that showed フ
        // at 3.8 seconds (record 0009). Same failure as a lesson score with no
        // age on it: a number that reads as mastery when it isn't. Split them.
        var reached = kanaKeys.filter(function (k) { return st.kana[k].masteredAt > since; });
        var newlyMastered = reached.filter(function (k) { return st.kana[k].streak >= 3; });
        var wentSlow = reached.filter(function (k) { return st.kana[k].streak < 3; });
        if (newlyMastered.length) {
          L.push("  Newly mastered (" + newlyMastered.length + "): " + newlyMastered.join(" "));
        }
        if (wentSlow.length) {
          L.push("  Mastered then went slow — correct but no longer fast (" +
            wentSlow.length + "): " + wentSlow.join(" "));
        }
        var regressed = kanaKeys.filter(function (k) {
          return (st.kana[k].lastRelapseAt || 0) > since;
        });
        if (regressed.length) {
          L.push("  REGRESSED — had mastered, then lost (" + regressed.length + "): " +
            regressed.join(" "));
        }
      }

      // Record 0008 found his misses were attractor answers — one romaji
      // absorbing four shapes — by counting typed answers by hand. This does it
      // every time, so a hub can never again hide behind a list of kana.
      var typedTally = {};
      kanaKeys.forEach(function (k) {
        var w = st.kana[k].wrong;
        if (!w || typeof w !== "object") return;
        Object.keys(w).forEach(function (t) {
          if (!typedTally[t]) typedTally[t] = { n: 0, shown: [] };
          typedTally[t].n += w[t];
          typedTally[t].shown.push(k);
        });
      });
      var hubs = Object.keys(typedTally)
        .filter(function (t) { return typedTally[t].shown.length > 1; })
        .sort(function (a, b) { return typedTally[b].n - typedTally[a].n; })
        .slice(0, 5);
      if (hubs.length) {
        L.push("");
        L.push("WHAT YOU TYPED INSTEAD (one answer, several kana = a hub)");
        hubs.forEach(function (t) {
          L.push("  " + t + " — " + typedTally[t].n + "x, for " +
            typedTally[t].shown.join(" "));
        });
      }

      L.push("");
      L.push("KANA STATE");
      L.push("  Mastered: " + mastered.length + "/" + (total || 92));
      L.push("  Never seen: " + Math.max(0, (total || 92) - kanaKeys.length));
      L.push("  Leeches (2+ lifetime misses, not yet mastered): " + leeches.length);
      // Worst enough first, and capped — a 92-line list is noise, and the full
      // truth is in the JSON below regardless.
      var shown = leeches.slice().sort(function (a, b) {
        return st.kana[b].lapses - st.kana[a].lapses;
      });
      shown.slice(0, 30).forEach(function (k) {
        L.push("    " + k + " — " + st.kana[k].lapses + " misses / " +
          st.kana[k].n + " attempts" +
          (st.kana[k].relapses ? " · relapsed " + st.kana[k].relapses + "x" : ""));
      });
      if (shown.length > 30) L.push("    … and " + (shown.length - 30) + " more");

      L.push("");
      L.push("LESSONS");
      var lids = Object.keys(st.lessons);
      if (!lids.length) L.push("  (none opened yet)");
      lids.forEach(function (id) {
        var l = st.lessons[id];
        L.push("  " + id + " — opened " + (l.opened || 0) + "x, completed " +
          (l.completed || 0) + "x" +
          (l.total ? ", last " + l.right + "/" + l.total : "") +
          (l.at ? " on " + new Date(l.at).toISOString().slice(0, 10) : ""));
      });

      L.push("");
      L.push("Storage: " + (writable() ? "ok" : "BLOCKED — this device is not saving progress"));
      L.push("");
      L.push("--- machine-readable state below, for Claude to store ---");
      L.push("```json");
      L.push(JSON.stringify(compact(st)));
      L.push("```");
      return L.join("\n");
    },

    // --- export / restore -------------------------------------------------
    // markExported is deliberately separate from report(): the delta only
    // advances when he actually copies, so previewing can't silently eat a
    // week of history.
    markExported: function () {
      var st = read();
      st.exportedAt = now();
      write(st);
    },

    restore: function (text) {
      var m = String(text).match(/```json\s*([\s\S]*?)```/);
      var parsed = JSON.parse(m ? m[1] : text);
      if (!parsed || parsed.v !== V) throw new Error("not a v" + V + " progress export");
      if (!parsed.k && !parsed.kana) throw new Error("export has no kana state");
      var st = expand(parsed);
      normalize(st.kana);
      write(st);
      return st;
    },

    reset: function () {
      memory = null;
      try { localStorage.removeItem(KEY); } catch (e) {}
    }
  };

  // Every page except the home page counts as a lesson view. Recorded here
  // rather than in quiz.js because the kana lessons don't load quiz.js at all —
  // putting it there silently missed exactly the lessons he uses most.
  document.addEventListener("DOMContentLoaded", function () {
    var id = window.Progress.lessonId();
    if (id === "index" || id === "") return;
    window.Progress.openLesson(id, document.title);
  });
})();
