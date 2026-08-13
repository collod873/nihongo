// Home page behaviour: what to do next, lesson state, and the bulk export.
//
// Everything here reads live state from progress.js rather than anything
// hardcoded at build time — the page should never claim a lesson is unfinished
// when he finished it last night.

(function () {
  function $(sel) { return document.querySelector(sel); }

  function daysSince(t) {
    if (!t) return null;
    return Math.floor((Date.now() - t) / 86400000);
  }

  function stats() {
    var st = window.Progress.all();
    var keys = Object.keys(st.kana);
    var total = (window.KanaDrill && window.KanaDrill.total) || 92;
    var mastered = keys.filter(function (k) { return st.kana[k].streak >= 3; });
    var leeches = keys.filter(function (k) {
      return st.kana[k].lapses >= 2 && st.kana[k].streak < 3;
    });
    var lastDrill = 0;
    st.sessions.forEach(function (s) {
      if (s.kind !== "quiz" && s.t > lastDrill) lastDrill = s.t;
    });
    return { st: st, total: total, seen: keys.length, mastered: mastered,
             leeches: leeches, lastDrill: lastDrill };
  }

  // One line, one instruction. The whole point is that he shouldn't have to ask
  // me — or himself — what today's work is.
  function nextUp(s) {
    var d = daysSince(s.lastDrill);
    if (!s.seen) return "Start with the full 92 — it measures where you actually are.";
    if (d === null || d >= 2) {
      return "It's been " + (d === null ? "a while" : d + " days") +
        " — drill kana first. " + s.leeches.length + " leeches waiting.";
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
    if (!el) return;
    el.textContent = s.mastered.length + " / " + s.total + " mastered · " +
      s.leeches.length + " leech" + (s.leeches.length === 1 ? "" : "es") +
      (s.lastDrill ? " · last drilled " +
        (daysSince(s.lastDrill) === 0 ? "today" : daysSince(s.lastDrill) + "d ago") : "");
    var n = $("#next");
    if (n) n.textContent = nextUp(s);
    if (!window.Progress.writable()) {
      var w = $("#warn");
      if (w) {
        w.textContent = "This device isn't saving progress. Export and paste to " +
          "Claude before you close the app, or this session is lost.";
        w.hidden = false;
      }
    }
  }

  // Badge each lesson from real state instead of a hardcoded note.
  function renderLessons() {
    var st = window.Progress.all();
    document.querySelectorAll("a[data-lesson]").forEach(function (a) {
      var l = st.lessons[a.dataset.lesson];
      var tag = document.createElement("span");
      tag.className = "idx-state";
      if (!l || !l.opened) { tag.textContent = "new"; tag.classList.add("is-new"); }
      else if (l.completed) {
        tag.textContent = l.total ? "done " + l.right + "/" + l.total : "done";
        tag.classList.add("is-done");
      } else { tag.textContent = "started"; }
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
        renderStatus();
        btn.textContent = "Restored ✓";
      } catch (e) {
        btn.textContent = "Couldn't read that — " + e.message;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    renderStatus();
    renderLessons();
    wireExport();
    wireRestore();
  });
})();
