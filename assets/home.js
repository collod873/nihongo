// Home page behaviour: what to do next, lesson state, and the bulk export.
//
// Reads live state from progress.js, falling back to the build-time seed in
// #seed for anything this device has no record of. The site moved to a new
// origin, so a device with real history behind it can still legitimately know
// nothing — and a page that responds by calling five finished lessons "new" is
// worse than useless.
//
// The seed is display only. It is never written into the store, so the export
// stays a record of what actually happened on the device.

(function () {
  function $(sel) { return document.querySelector(sel); }

  // Filled on DOM-ready, not at parse time: this script is loaded from <head>,
  // so #seed does not exist yet when the module body runs. Reading it here
  // returned null silently and the page reported zero of everything.
  var SEED = { miss: [], slow: [], lessons: {} };

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
    return Math.round(d / 7) + " weeks ago";
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
      // Nothing on this device. Report what the last diagnostic established
      // rather than zero — the trainer is weighted off exactly this list, and
      // a home page that disagreed with it would just be confusing.
      return { fromSeed: true, total: total, mastered: 0,
               leeches: SEED.miss, slow: SEED.slow, lastDrill: 0 };
    }
    return {
      fromSeed: false, total: total, lastDrill: lastDrill,
      mastered: keys.filter(function (k) { return st.kana[k].streak >= 3; }).length,
      leeches: keys.filter(function (k) {
        return st.kana[k].lapses >= 2 && st.kana[k].streak < 3;
      }),
      slow: []
    };
  }

  // What did he last do on each track, from real state or the seed.
  function trackAge(ids) {
    var st = window.Progress.all();
    var newest = 0;
    ids.forEach(function (id) {
      var l = st.lessons[id];
      if (l && l.at) newest = Math.max(newest, l.at);
      var s = SEED.lessons[id];
      if (s && s.on) newest = Math.max(newest, Date.parse(s.on + "T12:00:00Z") || 0);
    });
    return newest;
  }

  function lessonIds(track) {
    return [].slice.call(document.querySelectorAll("#" + track + " a[data-lesson]"))
      .map(function (a) { return a.dataset.lesson; });
  }

  // One line, one instruction — the point is that he shouldn't have to ask.
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

  function renderStatus() {
    var s = stats();
    var el = $("#status");
    if (el) {
      el.textContent = s.fromSeed
        ? s.leeches.length + " leeches and " + s.slow.length +
          " shaky, from your last full 92 · nothing drilled on this device yet"
        : s.mastered + " / " + s.total + " mastered · " + s.leeches.length +
          " leech" + (s.leeches.length === 1 ? "" : "es") +
          " · last drilled " + ago(days(s.lastDrill));
    }
    var n = $("#next");
    if (n) n.textContent = nextUp(s);

    // The speaking track has been idle for weeks. Say so, rather than leaving
    // him to notice he's gone rusty.
    var stale = $("#stale");
    if (stale) {
      var age = days(trackAge(lessonIds("speaking")));
      if (age !== null && age >= 21) {
        stale.textContent = "Speaking track: nothing since " + ago(age) +
          ". Worth a review pass before new material — say the word and I'll build one.";
        stale.hidden = false;
      }
    }

    if (!window.Progress.writable()) {
      var w = $("#warn");
      if (w) {
        w.textContent = "This device isn't saving progress. Export and paste to " +
          "Claude before you close the app, or this session is lost.";
        w.hidden = false;
      }
    }
  }

  function renderLessons() {
    var st = window.Progress.all();
    document.querySelectorAll("a[data-lesson]").forEach(function (a) {
      var id = a.dataset.lesson;
      var live = st.lessons[id];
      var seed = SEED.lessons[id];
      var tag = document.createElement("span");
      tag.className = "idx-state";

      if (live && live.completed) {
        tag.textContent = live.total ? "done " + live.right + "/" + live.total : "done";
        tag.classList.add("is-done");
      } else if (seed && seed.total) {
        tag.textContent = "done " + seed.right + "/" + seed.total;
        tag.classList.add("is-done");
        tag.title = "completed " + seed.on;
      } else if ((live && live.opened) || (seed && seed.started)) {
        tag.textContent = "unfinished";
        tag.classList.add("is-part");
      } else {
        tag.textContent = "new";
        tag.classList.add("is-new");
      }
      a.parentNode.appendChild(tag);
    });
  }

  function wireExport() {
    var btn = $("#export");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var text = window.Progress.report(
        (window.KanaDrill && window.KanaDrill.total) || 92);
      function done() {
        // Only advance the delta marker once it's genuinely on the clipboard —
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
      if (box.hidden) { box.hidden = false; box.focus(); return; }
      if (!box.value.trim()) { box.hidden = true; return; }
      try {
        window.Progress.restore(box.value);
        box.hidden = true; box.value = "";
        document.querySelectorAll(".idx-state").forEach(function (t) { t.remove(); });
        renderStatus(); renderLessons();
        btn.textContent = "Restored ✓";
      } catch (e) {
        btn.textContent = "Couldn't read that — " + e.message;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    readSeed();
    renderStatus();
    renderLessons();
    wireExport();
    wireRestore();
  });
})();
