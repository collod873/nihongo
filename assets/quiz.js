// Shared quiz + speech components for all lessons.
//
// Quiz: <div class="quiz" data-q="Question?" data-answer="1"
//            data-opts='["opt a","opt b","opt c"]'
//            data-fb='["why wrong","why right","why wrong"]'></div>
// data-answer is the 0-based index of the correct option.
//
// Speech: <button class="speak-btn" data-say="すみません">🔊</button>
// Uses the browser's built-in Japanese voice (no network needed).

(function () {
  function speakJa(text) {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = 0.85;
    var ja = speechSynthesis.getVoices().filter(function (v) {
      return v.lang && v.lang.indexOf("ja") === 0;
    });
    if (ja.length) u.voice = ja[0];
    speechSynthesis.speak(u);
  }
  // Some browsers load voices async
  if (window.speechSynthesis) speechSynthesis.getVoices();

  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".speak-btn");
    if (btn && btn.dataset.say) speakJa(btn.dataset.say);
  });

  function buildQuiz(el) {
    var opts = JSON.parse(el.dataset.opts);
    var fbs = el.dataset.fb ? JSON.parse(el.dataset.fb) : null;
    var answer = parseInt(el.dataset.answer, 10);

    var q = document.createElement("div");
    q.className = "quiz-q";
    q.textContent = el.dataset.q;
    el.appendChild(q);

    var fb = document.createElement("div");
    fb.className = "quiz-fb";

    var buttons = opts.map(function (opt, i) {
      var b = document.createElement("button");
      b.className = "quiz-opt";
      b.textContent = opt;
      b.addEventListener("click", function () {
        if (el.dataset.done) return;
        el.dataset.done = "1";
        buttons[answer].classList.add("correct");
        if (i !== answer) b.classList.add("wrong");
        fb.style.display = "block";
        fb.textContent = (i === answer ? "✓ " : "✗ ") + (fbs ? fbs[i] : (i === answer ? "Correct." : "Not quite — the highlighted answer is right."));
        recordResult(el, i === answer, opts[i], opts[answer]);
      });
      el.appendChild(b);
      return b;
    });

    el.appendChild(fb);
  }

  // Results summary — appears once every quiz on the page is answered.
  // "Copy results" produces a plain-text report to paste into the Claude
  // session so the next lesson can be paced off actual performance.
  var results = [];
  var totalQuizzes = 0;

  function recordResult(el, correct, chosen, correctOpt) {
    results.push({
      n: results.length + 1,
      q: el.dataset.q,
      correct: correct,
      chosen: chosen,
      correctOpt: correctOpt
    });
    if (results.length === totalQuizzes) showSummary();
  }

  function resultsText() {
    var score = results.filter(function (r) { return r.correct; }).length;
    var lines = [document.title, "Score: " + score + "/" + results.length];
    results.forEach(function (r) {
      lines.push(
        r.correct
          ? "Q" + r.n + " ✓"
          : "Q" + r.n + " ✗ — \"" + r.q + "\" chose \"" + r.chosen + "\" (correct: \"" + r.correctOpt + "\")"
      );
    });
    return lines.join("\n");
  }

  function showSummary() {
    var score = results.filter(function (r) { return r.correct; }).length;

    // Persist before rendering. Lesson results used to live only in this
    // closure, so closing the tab without hitting copy threw the whole lesson
    // away — and "I did three lessons this week" was unreportable.
    window.Progress.completeLesson(
      window.Progress.lessonId(), document.title, score, results.length,
      results.filter(function (r) { return !r.correct; }).map(function (r) { return "Q" + r.n; })
    );

    var box = document.createElement("div");
    box.className = "quiz-summary";

    var h = document.createElement("div");
    h.className = "quiz-summary-score";
    h.textContent = "Lesson complete — " + score + "/" + results.length;
    box.appendChild(h);

    var p = document.createElement("p");
    p.textContent = "Copy your results and paste them to Claude (from any device) — your next lesson is built from them.";
    box.appendChild(p);

    var btn = document.createElement("button");
    btn.className = "copy-results-btn";
    btn.textContent = "Copy results for Claude";
    btn.addEventListener("click", function () {
      var text = resultsText();
      function done() { btn.textContent = "Copied ✓ — paste it to Claude"; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
      } else {
        fallback(text, done);
      }
    });
    box.appendChild(btn);

    // Fallback for browsers that block clipboard API: show selectable text
    function fallback(text, done) {
      var pre = box.querySelector("pre") || document.createElement("pre");
      pre.textContent = text;
      pre.className = "quiz-summary-raw";
      box.appendChild(pre);
      done();
    }

    var last = document.querySelectorAll(".quiz");
    last[last.length - 1].after(box);
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var quizzes = document.querySelectorAll(".quiz");
    totalQuizzes = quizzes.length;
    quizzes.forEach(buildQuiz);
  });
})();
