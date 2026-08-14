// Kana drill component — typed-recall trainer with latency scoring,
// leech weighting, contrast injection, and cross-session persistence.
//
// Usage: <div class="kana-drill" data-mode="diagnostic"></div>
//        <div class="kana-drill" data-mode="drill" data-count="40"></div>
//        <div class="kana-drill" data-mode="confusables" data-count="30"></div>
//        <div class="kana-drill" data-mode="drill" data-family="hook"></div>
//        <div class="kana-drill" data-mode="drill" data-kana="フワヲヌス"></div>
//
// Modes:
//   diagnostic  — all 92 once, shuffled, minimal feedback (measure, don't teach)
//   drill       — adaptive, weighted toward leeches, full feedback + tips
//   confusables — only kana that belong to a confusable group you've missed
//
// data-family / data-kana narrow the pool to one set (drill/confusables only).
// Ignored in diagnostic mode, which must always be all 92.
//
// State lives in localStorage under KEY so an on-and-off learner resumes
// their actual leech list instead of restarting from あ every time.

(function () {
  var KEY = "kana-drill-v1";
  var FAST_MS = 1800;   // above this, a correct answer is not mastery
  var SLOW_MS = 3500;   // above this, it was reconstructed, not recalled
  var TYPO_GRACE_MS = 1500;  // window to fix a full field that spells nothing

  // ---- Data -------------------------------------------------------------

  var HIRA = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん";
  var KATA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
  var ROMAJI = ("a i u e o ka ki ku ke ko sa shi su se so ta chi tsu te to na ni nu ne no " +
                "ha hi fu he ho ma mi mu me mo ya yu yo ra ri ru re ro wa wo n").split(" ");

  // Accepted alternate (kunrei-style) romanisations.
  // Deliberately absent:
  //   を — must be "wo"; accepting "o" would make it indistinguishable from お.
  //   ん — must be "n"; adding "nn" would push maxLength to 2, so the correct
  //        single "n" would stall instead of advancing.
  var ALT = {
    shi: ["si"], chi: ["ti"], tsu: ["tu"], fu: ["hu"]
  };

  // Discrimination tips, keyed by kana. These fire on a miss — the moment
  // the learner is actually paying attention.
  var TIP = {
    // hiragana
    "る": "る closes into a loop at the bottom. ろ doesn't.",
    "ろ": "ろ ends open — no loop. る has the loop.",
    "ぬ": "ぬ has no straight left stem — it's all curves. ね, わ and れ all have one. (め is ぬ with no loop.)",
    "め": "め has no loop. ぬ does.",
    "さ": "さ has one crossbar. き has two.",
    "き": "き has two crossbars. さ has one.",
    "ち": "ち is さ mirrored — the curve hangs to the right.",
    "れ": "れ ends in a straight flick. わ curls round, ね loops closed.",
    "わ": "わ ends in a round open curve. ね loops closed, れ flicks straight, を adds a top bar.",
    "ね": "ね ends in a closed loop. わ curls open, れ flicks straight.",
    "は": "は = left stem + one crossbar. ほ has two crossbars.",
    "ほ": "ほ has two crossbars. は has one.",
    "ま": "ま's strokes cross a single vertical. は has a separate left stem.",
    "う": "う wears a hat — the little stroke on top. つ is bare.",
    "つ": "つ is bare. う has the hat stroke on top.",
    "い": "い is two separate short strokes. り is taller and connected.",
    "り": "り is taller, strokes closer and curving. い is two short marks.",
    "せ": "せ has the crossbar through the vertical. ち has no crossbar.",
    "す": "す has the loop below the crossbar. お has an extra side dot.",
    "お": "お has the side dot on the right. す doesn't.",
    "こ": "こ is two horizontal strokes. い is two vertical ones.",
    "へ": "へ (hiragana) and ヘ (katakana) are near-identical — context decides.",
    // katakana
    "ソ": "ソ's small stroke drops from the TOP, steeply. ン's comes in from the LEFT, shallow.",
    "ン": "ン's small stroke comes in from the LEFT, shallow. ソ's drops from the TOP.",
    "シ": "シ's marks sit on the LEFT and sweep UP — same side as ン.",
    "ツ": "ツ's marks sit on TOP and sweep DOWN — same side as ソ.",
    "ク": "ク has a short stroke at top-left then a long diagonal. ケ's diagonal cuts across.",
    "ケ": "ケ has a stroke cutting across the diagonal. ク doesn't.",
    // ワ survived Lesson 7 as the last of the "fu" hub (record 0009). Every other
    // member differs from フ by something ADDED — a leg, a crossing stroke, a top
    // bar — and those resolved. ワ's difference is structural, so the old tip
    // ("フ plus a left vertical") kept フ activated while he tried to rule it out.
    // Both tips now hang on one feature he can check in the moment: how many ends
    // of the top bar come down.
    "ワ": "ワ's top bar comes down at BOTH ends — left side closed. フ's comes down at one.",
    "ウ": "ウ wears the hat. ワ is bare — same relationship as う/つ.",
    "フ": "フ's top bar comes down at ONE end only — the left stays open. ワ closes both.",
    "ラ": "ラ's top stroke is short and stops early. ヲ's runs the full width. フ has none.",
    "ス": "ス is フ with a leg kicking out below-left. ヌ is ス with a stroke crossing it.",
    "ヌ": "ヌ is ス with a stroke crossing through. フ has no leg at all.",
    "ナ": "ナ is a plain plus. メ is an X. Add a tick on top and it's チ; a tick and a foot, ネ.",
    "メ": "メ is an X. ナ is a plus.",
    "チ": "チ = ナ plus a tick above the bar. Add a foot at the bottom left and it's ネ. テ's top is a second flat bar.",
    "テ": "テ has a flat top line. チ's top stroke slants across.",
    "ホ": "ホ has two loose side dots. オ is connected through.",
    "オ": "オ is connected. ホ has separate side dots.",
    "マ": "マ's corner is at the top-right, then sweeps down-left.",
    "ム": "ム's corner is at the bottom-left.",
    "コ": "コ is a bracket, open on the left. ユ has the bottom bar running through.",
    "ユ": "ユ has a long bottom bar and an open top. ロ is a closed box, コ an open bracket.",
    "エ": "エ is two bars joined by a vertical — like the kanji 工.",
    "ノ": "ノ is a single diagonal. ソ adds a second small stroke, ナ adds a crossbar.",
    "ヘ": "ヘ (katakana) and へ (hiragana) are near-identical — context decides.",
    "ロ": "ロ is a closed box. コ is open on the left.",
    "ア": "ア's inner stroke hangs down from the crossbar. マ's sweeps from the corner, オ's is a full vertical.",
    // cross-script twins: no shape rule exists, so the tip is the reassurance
    "リ": "リ (katakana) vs り (hiragana) — same sound either way, so this one is free.",
    "ヤ": "ヤ (katakana) vs や (hiragana) — same sound either way.",
    "モ": "モ is two bars with a vertical hooking through. ホ has a vertical with loose side dots.",
    "セ": "セ (katakana) vs せ (hiragana) — same sound either way.",
    "カ": "カ (katakana) vs か (hiragana) — same sound either way.",
    "や": "や (hiragana) vs ヤ (katakana) — same sound either way.",
    "も": "も (hiragana) vs モ (katakana) — same sound either way.",
    // added from the 2026-08-13 diagnostic — pairs actually swapped in practice
    "ネ": "ネ is the busiest one — tick on top, bar, stem AND a foot at the bottom left. チ has no foot; ヌ and ス have no bar.",
    "サ": "サ has two short verticals through the bar. セ has one vertical and a curling base.",
    "ヨ": "ヨ is three bars open to the left. コ is two. ユ has the long base bar.",
    "ハ": "ハ is two separate strokes leaning apart. ホ has a vertical running through it.",
    "ル": "ル's right stroke curves up and out. リ's drops straight down.",
    "ト": "ト is one vertical with a tick to the right. Nothing like よ (yo).",
    "よ": "よ has a loop at the bottom. ト (to) is just a vertical plus a tick.",
    "あ": "あ has a crossbar and a loop. お has the side dot on the right.",
    "た": "た's left side is a small cross. に's left is a straight stem.",
    "に": "に is a straight left stem plus two bars. た's left is a cross.",
    "け": "け is a straight left stem plus a curved right. せ has the crossbar.",
    // added from the 2026-08-13 clean full-92 (record 0008). Two hubs showed up:
    // フ absorbed ヲ/ヌ/ワ, and ネ/ね absorbed チ/ナ and れ/ぬ. Tips for hub members
    // name the hub explicitly — pairwise wording doesn't fix a 4-way collapse.
    "ヲ": "ヲ is フ with a full-width bar across the top. ラ's top stroke is short and stops early.",
    "ミ": "ミ is three separate strokes, stacked and shrinking. モ has a vertical through the bars.",
    "ニ": "ニ is two flat bars, nothing else. ノ is a single diagonal.",
    "レ": "レ is one stroke — down, then up to the right. リ is two separate strokes.",
    "み": "み has a loop crossed by a tail. め is a plain X-and-loop, no crossbar.",
    "く": "く is a sharp corner opening right. へ is a shallow corner opening down.",
    "を": "を has the extra left stroke on top. お is round; わ has no top bar."
  };

  // Confusable groups drive contrast injection: miss one, and a partner is
  // scheduled a couple of cards later so discrimination is forced.
  // Groups marked (obs) came from the 2026-08-13 diagnostic — pairs actually
  // swapped in practice, several of them in both directions.
  var GROUPS = [
    ["る", "ろ"], ["ぬ", "め", "ね"], ["さ", "き", "ち"], ["れ", "わ", "ね"],
    ["は", "ほ", "ま"], ["う", "つ"], ["い", "り"], ["す", "お", "あ"], ["せ", "ち"],
    ["け", "せ"], ["た", "に"],                                    // (obs)
    ["ソ", "ン", "ノ"], ["シ", "ツ", "チ"], ["ク", "ケ", "ワ"], ["ウ", "ワ", "フ"],
    ["ス", "ヌ", "ネ"], ["ナ", "メ"], ["チ", "テ"], ["ホ", "オ"], ["マ", "ム"],
    ["ラ", "フ"], ["コ", "ユ", "ロ", "ヨ"], ["ア", "マ"],
    ["サ", "セ"], ["ハ", "ホ"], ["ル", "リ"], ["ト", "よ"],          // (obs)
    ["へ", "ヘ"], ["り", "リ"], ["や", "ヤ"], ["も", "モ"], ["せ", "セ"],
    // (obs2) — from the clean full-92, record 0008. The first two are hubs, not
    // pairs: one romaji absorbed three or four different shapes.
    ["フ", "ワ", "ヲ", "ヌ", "ス"],        // everything hook-shaped came back "fu"
    ["ネ", "チ", "ナ", "ノ", "メ"],        // katakana half of the "ne" hub
    ["ミ", "モ"], ["ニ", "ノ"], ["レ", "リ"], ["ユ", "ロ"], ["ム", "マ", "ア"],
    ["み", "め"], ["く", "へ"], ["わ", "を"]
  ];

  // Named families a lesson can drill in isolation, via data-family.
  // Family drilling exists because pairwise contrast can't fix a hub — if "fu"
  // is the default answer for four shapes, ヌ-vs-ス leaves ヲ and ワ untouched.
  var FAMILIES = {
    hook: "フワヲヌスクケラウ",
    ne:   "ネチナノメれぬわね",
    marks: "シツソン"
  };

  var CARDS = [];
  HIRA.split("").forEach(function (c, i) { CARDS.push({ kana: c, romaji: ROMAJI[i], set: "hiragana" }); });
  KATA.split("").forEach(function (c, i) { CARDS.push({ kana: c, romaji: ROMAJI[i], set: "katakana" }); });

  var BY_KANA = {};
  CARDS.forEach(function (c) { BY_KANA[c.kana] = c; });

  var PARTNERS = {};
  GROUPS.forEach(function (g) {
    g.forEach(function (k) {
      if (!BY_KANA[k]) return;
      PARTNERS[k] = (PARTNERS[k] || []).concat(g.filter(function (o) { return o !== k && BY_KANA[o]; }));
    });
  });

  // romaji (incl. alternates) -> kana, per script. Lets us say
  // "you typed ru — that's る" instead of a bare "wrong".
  var LOOKUP = { hiragana: {}, katakana: {} };
  CARDS.forEach(function (c) {
    LOOKUP[c.set][c.romaji] = c.kana;
    (ALT[c.romaji] || []).forEach(function (a) { LOOKUP[c.set][a] = c.kana; });
  });

  function accepted(romaji) { return [romaji].concat(ALT[romaji] || []); }

  // Every string that spells some kana. A full field matching one of these is a
  // real confusion and commits immediately; anything else is probably a slip.
  var READINGS = {};
  ROMAJI.forEach(function (r) {
    accepted(r).forEach(function (a) { READINGS[a] = true; });
  });
  function isReading(s) { return READINGS[s] === true; }
  function maxLen(romaji) {
    return accepted(romaji).reduce(function (m, s) { return Math.max(m, s.length); }, 0);
  }

  // ---- Persistence ------------------------------------------------------

  // Storage belongs to progress.js now — the drill is one writer among several,
  // not the owner. Per-kana stats keep exactly the shape they always had, so
  // everything downstream of load()/save() is unchanged.
  function load() { return window.Progress.kana(); }
  function save(st) { window.Progress.saveKana(st); }
  function persistOK() { return window.Progress.writable(); }
  function slot(st, kana) {
    if (!st[kana]) st[kana] = { n: 0, ok: 0, streak: 0, lapses: 0, last: 0 };
    return st[kana];
  }
  function isLeech(s) { return s.lapses >= 2; }
  function isMastered(s) { return s.streak >= 3; }

  // ---- Seeded state -----------------------------------------------------
  //
  // On iOS the trainer runs in a cross-origin artifact frame, and saved to the
  // home screen it gets its own storage container on top of that — localStorage
  // is unreliable there and may be blocked outright. Without state, the leech
  // weighting is the whole point of this tool and it silently does nothing.
  //
  // So the page can carry a starting state instead of relying on the device:
  //   data-seed-miss="チみソ…"   last run's misses      -> weight 12
  //   data-seed-slow="をちイ…"   correct but slow       -> weight 6
  // anything else known to the seed is treated as solid -> weight 3
  // and anything not mentioned stays unseen             -> weight 8
  //
  // Seeds are refreshed from each results paste and republished, so the drill
  // is correctly weighted from card one on a device that stores nothing.
  function seedState(el) {
    var miss = (el.dataset.seedMiss || "").split("");
    var slow = (el.dataset.seedSlow || "").split("");
    if (!miss.length && !slow.length) return null;
    var st = {};
    CARDS.forEach(function (c) {
      st[c.kana] = { n: 1, ok: 1, streak: 2, lapses: 0, last: 0 };
    });
    slow.forEach(function (k) {
      if (st[k]) st[k] = { n: 1, ok: 1, streak: 1, lapses: 0, last: 0 };
    });
    // lapses:2 marks these as leeches (weight 20) rather than merely unseen.
    // That's a deliberate prior, not a claim about history: a kana missed on a
    // cold full-92 is exactly what the leech weighting exists to chase. Real
    // answers overwrite it the moment any get recorded.
    miss.forEach(function (k) {
      if (st[k]) st[k] = { n: 1, ok: 0, streak: 0, lapses: 2, last: 0 };
    });
    return st;
  }

  function weight(st, kana) {
    var s = st[kana];
    if (!s || s.n === 0) return 8;
    if (isLeech(s) && !isMastered(s)) return 20;
    if (isMastered(s)) return 1;
    return [12, 6, 3][s.streak] || 3;
  }

  // ---- Component --------------------------------------------------------

  function build(el) {
    var mode = el.dataset.mode || "drill";

    // data-family="hook" (a named FAMILIES set) or data-kana="フワヲ" (literal).
    // Restricts the pool so a lesson can drill one hub to exhaustion. Ignored in
    // diagnostic mode — that mode is a measurement of all 92 and nothing else.
    var only = null;
    if (mode !== "diagnostic") {
      var src = el.dataset.kana || FAMILIES[el.dataset.family] || "";
      var picked = src.split("").filter(function (k) { return BY_KANA[k]; });
      if (picked.length) only = picked;
    }

    var count = parseInt(el.dataset.count, 10) ||
      (mode === "diagnostic" ? CARDS.length : (only ? only.length * 3 : 40));

    var seed = seedState(el);
    var stored = persistOK();
    // The seed is a floor, not an override: anything the device has actually
    // recorded is newer than the seed and wins.
    function loadSeeded() {
      var st = load();
      if (!seed) return st;
      Object.keys(seed).forEach(function (k) { if (!st[k]) st[k] = seed[k]; });
      return st;
    }
    var st = loadSeeded();

    var queue = [], queueIdx = 0, pool = [];
    var forced = [];      // contrast-injected kana, jump the line
    var log = [];         // per-answer record for the summary
    var recent = [];      // avoid immediate repeats
    var current = null, shownAt = 0, answered = false, done = 0, lastTyped = "";
    var pendingSubmit = null;

    // --- markup
    el.innerHTML = "";
    var stage = document.createElement("div");
    stage.className = "kd-stage";

    var prog = document.createElement("div");
    prog.className = "kd-prog";
    stage.appendChild(prog);

    var face = document.createElement("div");
    face.className = "kd-face jp";
    stage.appendChild(face);

    var form = document.createElement("form");
    form.className = "kd-form";
    var input = document.createElement("input");
    input.className = "kd-input";
    input.type = "text";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("enterkeyhint", "go");
    input.placeholder = "type the sound";
    form.appendChild(input);
    stage.appendChild(form);

    // Drains over FAST_MS so the mastery window is visible rather than secret.
    // There is no hard limit — running out only means "logged as slow".
    var timer = document.createElement("div");
    timer.className = "kd-timer";
    var timerFill = document.createElement("i");
    timer.appendChild(timerFill);
    stage.appendChild(timer);

    var fb = document.createElement("div");
    fb.className = "kd-fb";
    stage.appendChild(fb);

    // Idle gate. Nothing is timed until this is tapped, so page load and
    // finding the input never land inside the first card's latency. The tap
    // is also a user gesture, which is what iOS needs to open the keyboard.
    var startPanel = document.createElement("div");
    startPanel.className = "kd-start";
    var startBtn = document.createElement("button");
    startBtn.className = "kd-start-btn";
    startBtn.type = "button";
    var startNote = document.createElement("div");
    startNote.className = "kd-start-note";
    startPanel.appendChild(startBtn);
    startPanel.appendChild(startNote);
    stage.appendChild(startPanel);

    el.appendChild(stage);

    var reduceMotion = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function startTimer() {
      timer.style.opacity = "";
      timerFill.style.transition = "none";
      timerFill.style.transform = "scaleX(1)";
      if (reduceMotion) return;
      void timerFill.offsetWidth;                      // force reflow so the reset takes
      timerFill.style.transition = "transform " + FAST_MS + "ms linear";
      timerFill.style.transform = "scaleX(0)";
    }
    function stopTimer() { timer.style.opacity = "0"; }

    var LABEL = { diagnostic: "Full 92", drill: "Daily drill", confusables: "Confusables" };
    var label = only ? (only.length + "-kana family") : (LABEL[mode] || mode);

    function mountStage() {
      stage.innerHTML = "";
      [prog, face, form, timer, fb, startPanel].forEach(function (n) { stage.appendChild(n); });
    }

    function showStart(first) {
      mountStage();
      stage.classList.add("kd-idle");
      startBtn.textContent = first ? "Start" : "Go again";
      startNote.textContent = label + " · " + count +
        " cards · nothing is timed until you tap";
      timer.style.opacity = "";
      timerFill.style.transition = "none";
      timerFill.style.transform = "scaleX(1)";
    }

    function begin() {
      stage.classList.remove("kd-idle");
      log = []; recent = []; forced = []; done = 0;
      st = loadSeeded();
      buildQueue();
      // focus inside the click gesture — iOS won't raise the keyboard otherwise
      input.focus();
      next();
    }

    startBtn.addEventListener("click", begin);

    // --- queue construction
    function buildQueue() {
      queueIdx = 0;
      if (mode === "diagnostic") {
        // Every kana exactly once, no top-ups, no injections. It's a measurement.
        pool = [];
        queue = shuffle(CARDS.map(function (c) { return c.kana; }));
        return;
      }
      pool = CARDS.map(function (c) { return c.kana; });
      if (only) {
        pool = only.slice();
      } else if (mode === "confusables") {
        pool = pool.filter(function (k) {
          var s = st[k];
          return PARTNERS[k] && (!s || !isMastered(s));
        });
        if (!pool.length) pool = Object.keys(PARTNERS).filter(function (k) { return BY_KANA[k]; });
      }
      // Build with a rolling window of what's already queued. pick() spaces
      // cards using `recent`, but `recent` only fills as cards are *answered* —
      // so building the whole queue up front used to ignore spacing entirely and
      // could deal the same kana twice in a row. Invisible with a 92-kana pool,
      // obvious with a 9-kana family.
      queue = [];
      var queued = [];
      for (var i = 0; i < count; i++) {
        var k = pick(pool, queued);
        queue.push(k);
        queued.unshift(k);
        if (queued.length > 6) queued.pop();
      }
    }

    // `avoid` defaults to the answered-recently window; buildQueue passes its own
    // rolling window instead, since nothing has been answered yet.
    function pick(pool, avoid) {
      var skip = avoid || recent;
      var avail = pool.filter(function (k) { return skip.indexOf(k) === -1; });
      if (!avail.length) avail = pool;
      var total = avail.reduce(function (t, k) { return t + weight(st, k); }, 0);
      var r = Math.random() * total;
      for (var i = 0; i < avail.length; i++) {
        r -= weight(st, avail[i]);
        if (r <= 0) return avail[i];
      }
      return avail[avail.length - 1];
    }

    function shuffle(a) {
      a = a.slice();
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }

    // --- card cycle
    function next() {
      if (done >= count) return finish();
      // queueIdx is tracked separately from `done`: an injected contrast card
      // answers a slot without consuming a queue entry. Indexing the queue by
      // `done` used to skip a kana for every injection — in diagnostic mode
      // that meant some of the 92 never appeared at all.
      var kana;
      if (forced.length) kana = forced.shift();
      else if (queueIdx < queue.length) kana = queue[queueIdx++];
      else if (pool.length) kana = pick(pool);
      if (!kana) return finish();
      current = BY_KANA[kana];
      answered = false;
      clearTimeout(pendingSubmit);
      fb.className = "kd-fb";
      fb.textContent = "";
      face.textContent = current.kana;
      face.className = "kd-face jp";
      input.value = "";
      lastTyped = "";
      input.maxLength = maxLen(current.romaji);
      prog.textContent = (done + 1) + " / " + count;
      startTimer();
      shownAt = performance.now();
      // Never disable/blur the input — on iOS that dismisses the keyboard and
      // every card would cost an extra tap to get it back.
      if (document.activeElement !== input) input.focus();
    }

    function submit() {
      if (answered || !current) return;
      var typed = input.value.trim().toLowerCase();
      if (!typed) return;
      answered = true;
      clearTimeout(pendingSubmit);
      lastTyped = input.value;
      stopTimer();
      var ms = Math.round(performance.now() - shownAt);
      var ok = accepted(current.romaji).indexOf(typed) !== -1;
      var fast = ms < FAST_MS;

      var s = slot(st, current.kana);
      var wasMastered = isMastered(s);
      s.n++;
      s.last = ms;
      if (ok) {
        s.ok++;
        s.streak = fast ? s.streak + 1 : 1;   // slow = still in rotation
      } else {
        s.streak = 0;
        s.lapses++;
        var mistook = LOOKUP[current.set][typed];
        if (mode !== "diagnostic" && mistook && PARTNERS[current.kana] &&
            PARTNERS[current.kana].indexOf(mistook) !== -1 && forced.indexOf(mistook) === -1) {
          forced.push(mistook);   // contrast injection
        }
      }
      window.Progress.noteKana(current.kana, s, wasMastered);
      save(st);

      log.push({
        kana: current.kana, romaji: current.romaji, set: current.set,
        typed: typed, ok: ok, ms: ms, fast: fast
      });

      recent.unshift(current.kana);
      if (recent.length > 6) recent.pop();

      done++;
      render(ok, fast, ms, typed);
    }

    function render(ok, fast, ms, typed) {
      if (mode === "diagnostic") {
        // Measure, don't teach — a bare mark, then straight on.
        face.className = "kd-face jp " + (ok ? "kd-ok" : "kd-no");
        fb.className = "kd-fb show";
        fb.textContent = ok ? (fast ? "✓" : "✓ slow") : "✗";
        setTimeout(next, ok ? 260 : 500);
        return;
      }
      face.className = "kd-face jp " + (ok ? "kd-ok" : "kd-no");
      fb.className = "kd-fb show";
      if (ok && fast) {
        fb.textContent = "✓ " + current.romaji + "  ·  " + ms + "ms";
        setTimeout(next, 380);
        return;
      }
      var parts = [];
      if (ok) {
        parts.push("✓ " + current.romaji + " — but " + ms + "ms. Recognised, not recalled.");
      } else {
        parts.push("✗ " + current.kana + " = " + current.romaji + ".");
        var mistook = LOOKUP[current.set][typed];
        if (mistook) parts.push('You typed "' + typed + '" — that\'s ' + mistook + ".");
      }
      if (TIP[current.kana]) parts.push(TIP[current.kana]);
      fb.innerHTML = parts.join(" ") + '<div class="kd-cont">tap or press enter to continue</div>';
      // Wrong answers wait for a deliberate action — reading the tip is the point.
      var go = function (e) {
        if (e.type === "keydown" && e.key !== "Enter") return;
        e.preventDefault();
        document.removeEventListener("keydown", go);
        fb.removeEventListener("click", go);
        next();
      };
      document.addEventListener("keydown", go);
      fb.addEventListener("click", go);
    }

    function finish() {
      var right = log.filter(function (r) { return r.ok; }).length;
      var solid = log.filter(function (r) { return r.ok && r.fast; }).length;
      var shaky = log.filter(function (r) { return r.ok && !r.fast; });
      var missed = log.filter(function (r) { return !r.ok; });

      // Recorded here rather than per-answer: a session is the unit he'd
      // recognise, and it's what the delta in the bulk export reads.
      window.Progress.noteDrill(mode, window.Progress.lessonId(), right, log.length,
        solid, missed.map(function (r) { return r.kana; }));

      stage.innerHTML = "";
      var box = document.createElement("div");
      box.className = "kd-summary";

      var h = document.createElement("div");
      h.className = "kd-summary-score";
      h.textContent = right + " / " + log.length + " correct · " + solid + " solid";
      box.appendChild(h);

      var sub = document.createElement("p");
      sub.textContent = "Solid = correct in under " + (FAST_MS / 1000) +
        "s. Anything slower you reconstructed rather than recalled — it stays in rotation.";
      box.appendChild(sub);

      if (missed.length) box.appendChild(list("Missed", missed, true));
      if (shaky.length) box.appendChild(list("Slow — correct but not automatic", shaky, false));

      // Say it out loud rather than silently pretending to track progress.
      if (!stored) {
        var warn = document.createElement("p");
        warn.className = "kd-warn";
        warn.textContent = seed
          ? "This device won't save progress, so today's answers stop here. " +
            "The drill is still weighted from your last diagnostic — paste your " +
            "results to Claude and the weighting gets refreshed."
          : "This device won't save progress — every session starts cold. " +
            "Paste your results to Claude.";
        box.appendChild(warn);
      }

      var btn = document.createElement("button");
      btn.className = "copy-results-btn";
      btn.textContent = "Copy results for Claude";
      btn.addEventListener("click", function () {
        var text = report();
        function ok() { btn.textContent = "Copied ✓ — paste it to Claude"; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(ok, function () { raw(text, ok); });
        } else { raw(text, ok); }
      });
      box.appendChild(btn);

      var again = document.createElement("button");
      again.className = "kd-again";
      again.textContent = "Go again";
      again.addEventListener("click", function () { showStart(false); });
      box.appendChild(again);

      function raw(text, cb) {
        var pre = document.createElement("pre");
        pre.className = "quiz-summary-raw";
        pre.textContent = text;
        box.appendChild(pre);
        cb();
      }

      stage.appendChild(box);
      box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function list(title, rows, showTyped) {
      var d = document.createElement("div");
      d.className = "kd-list";
      var t = document.createElement("h3");
      t.textContent = title + " (" + rows.length + ")";
      d.appendChild(t);
      rows.forEach(function (r) {
        var row = document.createElement("div");
        row.className = "kd-row";
        row.innerHTML = '<span class="jp kd-row-kana">' + r.kana + '</span>' +
          '<span class="kd-row-ans">' + r.romaji + '</span>' +
          '<span class="kd-row-note">' +
          (showTyped ? 'you typed "' + r.typed + '"' : r.ms + "ms") + '</span>';
        d.appendChild(row);
      });
      return d;
    }

    function report() {
      var lines = [document.title, "Mode: " + mode];
      var right = log.filter(function (r) { return r.ok; }).length;
      var solid = log.filter(function (r) { return r.ok && r.fast; }).length;
      lines.push("Score: " + right + "/" + log.length + " correct, " + solid + " solid (<" + FAST_MS + "ms)");
      lines.push("");
      lines.push("MISSED:");
      var miss = log.filter(function (r) { return !r.ok; });
      if (!miss.length) lines.push("  (none)");
      miss.forEach(function (r) {
        lines.push("  " + r.kana + " (" + r.set + ") = " + r.romaji +
          ' — typed "' + r.typed + '" [' + r.ms + "ms]");
      });
      lines.push("");
      lines.push("SLOW BUT CORRECT:");
      var slow = log.filter(function (r) { return r.ok && !r.fast; });
      if (!slow.length) lines.push("  (none)");
      slow.forEach(function (r) {
        lines.push("  " + r.kana + " (" + r.set + ") = " + r.romaji + " [" + r.ms + "ms]");
      });
      lines.push("");
      lines.push("CUMULATIVE LEECHES (2+ lifetime misses, not yet mastered):");
      var leeches = Object.keys(st).filter(function (k) {
        return isLeech(st[k]) && !isMastered(st[k]);
      });
      if (!leeches.length) lines.push("  (none)");
      leeches.forEach(function (k) {
        lines.push("  " + k + " = " + (BY_KANA[k] ? BY_KANA[k].romaji : "?") +
          " — " + st[k].lapses + " misses / " + st[k].n + " attempts");
      });
      var mastered = Object.keys(st).filter(function (k) { return isMastered(st[k]); }).length;
      lines.push("");
      lines.push("Mastered: " + mastered + "/92");
      // Without this, "0 mastered / no leeches" is ambiguous between a genuine
      // first run and a store that has been silently blocked the whole time.
      lines.push("Persistence: " + (stored
        ? "ok (" + Object.keys(st).length + " kana tracked across sessions)"
        : "BLOCKED — progress is not saving, every session starts cold") +
        (seed ? " · seeded" : " · no seed"));
      return lines.join("\n");
    }

    // --- wiring
    form.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
    input.addEventListener("input", function () {
      // Swallow keystrokes during feedback instead of disabling the field —
      // disabling blurs it, which closes the mobile keyboard.
      if (answered) { if (input.value !== lastTyped) input.value = lastTyped; return; }
      if (!current) return;
      clearTimeout(pendingSubmit);
      var typed = input.value.trim().toLowerCase();
      // Right answer — commit instantly, that's the fast path.
      if (accepted(current.romaji).indexOf(typed) !== -1) return submit();
      if (typed.length < maxLen(current.romaji)) return;
      // Field is full. If it spells a real kana, that's a genuine confusion and
      // worth recording. If it spells nothing ("w", "lo", "tau"), it's a
      // fat-finger — hold briefly so it can be corrected instead of scored.
      if (isReading(typed)) return submit();
      pendingSubmit = setTimeout(submit, TYPO_GRACE_MS);
    });
    stage.addEventListener("click", function (e) {
      if (stage.classList.contains("kd-idle")) return;   // don't raise the keyboard before Start
      if (e.target === startBtn) return;
      if (!answered) input.focus();
    });

    showStart(true);
  }

  // Exposed so a host page can switch modes or reset progress without a reload.
  window.KanaDrill = {
    build: build,
    total: CARDS.length,
    // Exposed so a lesson's data-family can be checked against the real table
    // instead of a copy of it — a misspelled family silently drills all 92.
    family: function (name) { return FAMILIES[name] || ""; },
    reset: function () { window.Progress.reset(); },
    stats: function () {
      var st = load();
      // Fall back to the page's seed so a device that stores nothing still
      // reports the real leech list rather than "no history yet".
      if (!Object.keys(st).length) {
        var el = document.querySelector("[data-seed-miss],[data-seed-slow]");
        if (el) st = seedState(el) || st;
      }
      var keys = Object.keys(st);
      return {
        seen: keys.length,
        mastered: keys.filter(function (k) { return isMastered(st[k]); }).length,
        leeches: keys.filter(function (k) { return isLeech(st[k]) && !isMastered(st[k]); })
      };
    }
  };

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".kana-drill").forEach(build);
  });
})();
