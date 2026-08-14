// Home page behaviour: what to do today, what's gone stale, and the export.
//
// The build emits one catalogue of lessons and no running order. This file
// assembles the page from live state, falling back to the build-time seed in
// #seed for anything this device has no record of — the site moved origin, so a
// device with months of history behind it can still legitimately know nothing,
// and a page that responds by calling five finished lessons "new" is worse than
// showing nothing at all.
//
// Ordering principle: the page is a plan, not an archive. "Today" holds one
// action. "Review" is sorted by how long since he last saw a thing, because in
// language learning nothing is ever finished — a lesson he aced six weeks ago
// needs him more than one he did on Tuesday. The numbered catalogue still
// exists, collapsed, for when he wants to go find something specific.
//
// The seed is display only and is never written into the store, so the export
// stays a record of what actually happened on the device.

(function () {
  function $(sel) { return document.querySelector(sel); }
  function all(sel) { return [].slice.call(document.querySelectorAll(sel)); }

  var SEED = { miss: [], slow: [], lessons: {} };

  // Filled on DOM-ready, not at parse time: this script loads from <head>, so
  // #seed does not exist yet when the module body runs. Reading it there
  // returned null silently and the page reported zero of everything.
  function readSeed() {
    var el = $("#seed");
    if (!el) return;
    SEED.miss = el.dataset.seedMiss ? el.dataset.seedMiss.split("") : [];
    SEED.slow = el.dataset.seedSlow ? el.dataset.seedSlow.split("") : [];
    try { SEED.lessons = JSON.parse(el.dataset.seedLessons || "{}"); }
    catch (e) { SEED.lessons = {}; }
  }

  function days(t) { return t ? Math.floor((Date.now() - t) / 86400000) : null; }
  function ago(d) {
    if (d === null) return "never";
    if (d === 0) return "today";
    if (d === 1) return "yesterday";
    if (d < 21) return d + " days ago";
    if (d < 60) return Math.round(d / 7) + " weeks ago";
    return Math.round(d / 30) + " months ago";
  }

  // Everything known about one lesson, from the store first and the seed second.
  function lessonState(li) {
    var id = li.dataset.lesson;
    var live = window.Progress.all().lessons[id] || null;
    var seed = SEED.lessons[id] || null;
    var at = 0;
    if (live && live.at) at = live.at;
    else if (live && live.lastOpenedAt) at = live.lastOpenedAt;
    if (!at && seed && seed.on) at = Date.parse(seed.on + "T12:00:00Z") || 0;

    // A drill lesson has no quiz, so `completed` never gets set on it — Lesson 7
    // read "unfinished" after he drilled it twice to 26/27. Its finishing move is
    // a drill session logged against its own page id; use the newest one.
    var drill = null;
    window.Progress.all().sessions.forEach(function (s) {
      if (s.kind !== "quiz" && s.page === id && (!drill || s.t > drill.t)) drill = s;
    });
    if (drill && drill.t > at) at = drill.t;

    var done = !!(live && live.completed) || !!drill || !!(seed && seed.total);
    var started = !done && (!!(live && live.opened) || !!(seed && seed.started));
    var score = null;
    if (live && live.completed && live.total) score = live.right + "/" + live.total;
    else if (drill) score = drill.right + "/" + drill.total;
    else if (seed && seed.total) score = seed.right + "/" + seed.total;

    return { id: id, li: li, track: li.dataset.track, mins: li.dataset.mins,
             at: at, done: done, started: started, score: score };
  }

  function stats() {
    var st = window.Progress.all();
    var keys = Object.keys(st.kana);
    var total = (window.KanaDrill && window.KanaDrill.total) || 92;
    var lastDrill = 0;
    st.sessions.forEach(function (s) {
      if (s.kind !== "quiz" && s.t > lastDrill) lastDrill = s.t;
    });
    if (!keys.length) {
      return { fromSeed: true, total: total, mastered: 0,
               leeches: SEED.miss, slow: SEED.slow, lastDrill: 0 };
    }
    return {
      fromSeed: false, total: total, lastDrill: lastDrill, slow: [],
      mastered: keys.filter(function (k) { return st.kana[k].streak >= 3; }).length,
      leeches: keys.filter(function (k) {
        return st.kana[k].lapses >= 2 && st.kana[k].streak < 3;
      })
    };
  }

  function nextUp(s) {
    var d = days(s.lastDrill);
    if (s.fromSeed) {
      return "Pick up where you left off — " + s.leeches.length +
        " leeches from your last full 92, already loaded into the drill.";
    }
    if (d === null || d >= 2) {
      return "Last drilled " + ago(d) + " — kana first. " +
        s.leeches.length + " leeches waiting.";
    }
    if (s.leeches.length > 15) {
      return s.leeches.length + " leeches in rotation. Drill, then a lesson if you have time.";
    }
    if (s.leeches.length) {
      return s.leeches.length + " leeches left: " + s.leeches.slice(0, 8).join(" ") +
        (s.leeches.length > 8 ? " …" : "");
    }
    return "No leeches left. Re-run the full 92 and let's see the real number.";
  }

  function badge(text, cls, title) {
    var t = document.createElement("span");
    t.className = "idx-state" + (cls ? " " + cls : "");
    t.textContent = text;
    if (title) t.title = title;
    return t;
  }

  function render() {
    var s = stats();

    var st = $("#status");
    if (st) {
      st.textContent = s.fromSeed
        ? s.leeches.length + " leeches and " + s.slow.length +
          " shaky, from your last full 92 · nothing drilled on this device yet"
        : s.mastered + " / " + s.total + " mastered · " + s.leeches.length +
          " leech" + (s.leeches.length === 1 ? "" : "es") +
          " · last drilled " + ago(days(s.lastDrill));
    }
    var n = $("#next");
    if (n) n.textContent = nextUp(s);

    var lessons = all("#catalogue li[data-lesson]").map(lessonState);

    // Today: anything never opened, plus anything started and abandoned.
    // Newest first so the lesson just published leads.
    var todo = lessons.filter(function (l) { return !l.done; })
      .sort(function (a, b) { return b.id.localeCompare(a.id); });

    // Review: done, oldest first. This is the whole point of the section.
    var review = lessons.filter(function (l) { return l.done; })
      .sort(function (a, b) { return (a.at || 0) - (b.at || 0); });

    fill($("#todo"), todo, function (l) {
      return l.started
        ? badge("unfinished · " + ago(days(l.at)), "is-part")
        : badge("new", "is-new");
    });

    fill($("#review"), review, function (l) {
      var d = days(l.at);
      // Score alone reads as mastery. The date is the part that tells the truth.
      var cls = d !== null && d >= 21 ? "is-stale" : "is-done";
      return badge((l.score ? l.score + " · " : "") + ago(d), cls);
    });

    var empty = $("#review-empty");
    if (empty) empty.hidden = review.length > 0;

    if (!window.Progress.writable()) {
      var w = $("#warn");
      if (w) {
        w.textContent = "This device isn't saving progress. Export and paste to " +
          "Claude before you close the app, or this session is lost.";
        w.hidden = false;
      }
    }
  }

  // Clone catalogue rows into a section rather than moving them, so the full
  // list stays intact under "All lessons".
  function fill(ul, items, badgeFor) {
    if (!ul) return;
    ul.innerHTML = "";
    items.forEach(function (l) {
      var li = l.li.cloneNode(true);
      li.appendChild(badgeFor(l));
      ul.appendChild(li);
    });
  }

  function wireExport() {
    var btn = $("#export");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var text = window.Progress.report(
        (window.KanaDrill && window.KanaDrill.total) || 92);
      function done() {
        // Only advance the delta marker once it is genuinely on the clipboard —
        // marking on render would silently eat a week if the copy failed.
        window.Progress.markExported();
        btn.textContent = "Copied ✓ — paste it to Claude";
      }
      function fallback() {
        var pre = $("#export-raw");
        pre.textContent = text;
        pre.hidden = false;
        window.Progress.markExported();
        btn.textContent = "Copy failed — select the text below";
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else { fallback(); }
    });
  }

  function wireRestore() {
    var btn = $("#restore");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var box = $("#restore-box");
      if (!box.value.trim()) { btn.textContent = "Paste an export first"; return; }
      try {
        window.Progress.restore(box.value);
        box.value = "";
        render();
        btn.textContent = "Restored ✓";
      } catch (e) {
        btn.textContent = "Couldn't read that — " + e.message;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    readSeed();
    render();
    wireExport();
    wireRestore();
  });
})();
