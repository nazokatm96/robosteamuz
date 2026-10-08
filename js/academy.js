/* RoboSTEAM academy data: lesson tree (modules, lessons, locks), lesson view, performance page and the dashboard's
   "continue learning" card and stats. <body data-page="academy|progress|dashboard"> selects what runs.
   js/shell.js owns the layout (the tree lives in its sidebar / drawer), js/app.js the guard and user card,
   js/auth.js logout. Every user-facing string is in T. Tables and policies: supabase/academy-schema.sql. */
(function () {
  'use strict';

  var T = {
    loading: 'Yuklanmoqda…',
    loadError: "Darslarni yuklab bo'lmadi. Internet aloqasini tekshiring va qayta urinib ko'ring.",
    retry: 'Qayta urinish',
    empty: "Hozircha ochiq darslar yo'q. Tez orada qo'shiladi!",
    moduleN: '{n}-modul',
    lessonN: '{n}-dars',
    lessonsDone: '{d}/{t}',
    soon: 'Tez orada',
    locked: 'Qulflangan',
    lockedHint: 'Oldingi modulni tugatgach ochiladi',
    lessonLockedHint: 'Oldingi darsni tugatgach ochiladi',
    done: 'Tugatilgan',
    current: 'Hozirgi dars',
    minutes: '{m} daq',
    markComplete: 'Tugatildi deb belgilash',
    completed: 'Dars tugatildi',
    saveError: "Saqlab bo'lmadi. Qayta urinib ko'ring.",
    nextHint: "Keyingi darsga o'tish uchun darsni tugatilgan deb belgilang.",
    lastLesson: "Bu ochiq darslarning oxirgisi. Keyingi modul tez orada!",
    videoSoon: "Video tez orada qo'shiladi",
    progressLine: '{d} / {t} dars tugatildi',
    progressModule: '{d} / {t} dars · {p}%',
    // dashboard
    nextIn: '{m} · {l}',
    moduleProgress: 'Modul: {d} / {t} dars',
    startFirst: 'Birinchi darsni boshlash',
    continueBtn: 'Davom ettirish',
    allDone: 'Barcha ochiq darslar tugatildi!',
    allDoneText: "Zo'r ish! Keyingi modul tez orada qo'shiladi. Natijalaringizni ko'rib chiqing.",
    seeProgress: "Natijalarni ko'rish",
    noLessons: 'Darslar tez orada',
    noLessonsText: "Hozircha ochiq darslar yo'q. Qo'shilishi bilan shu yerda paydo bo'ladi.",
    statLessons: '{d} / {t}',
    statModules: '{d} / {t}',
    statsEmpty: "Hali birorta dars tugatilmagan. Birinchi darsdan boshlang, natijalar shu yerda ko'rinadi!",
    // lesson quiz
    questionN: '{n}-savol',
    quizAnswerAll: 'Avval barcha savollarga javob bering.',
    quizScore: "{s} / {t} ta to'g'ri javob.",
    quizPerfect: "Barakalla! Hamma javoblar to'g'ri.",
    quizError: "Javoblarni tekshirib bo'lmadi. Qayta urinib ko'ring.",
    right: "to'g'ri javob",
    wrong: "noto'g'ri",
  };

  var sb = window.sb || null;
  var page = document.body.getAttribute('data-page') || '';
  var ICON = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  // raw rows from the database, and the model built from them (see build)
  var data = null, model = null, current = null, userId = null;
  var openModules = {}; // module id -> expanded in the sidebar

  // ---------- helpers ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function fmt(s, v) { return s.replace(/\{(\w+)\}/g, function (_, k) { return v[k]; }); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v; // only ever our own ICON strings
      else n.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function lessonHref(lesson) { return 'academy.html?lesson=' + encodeURIComponent(lesson.id); }

  // ---------- data ----------
  async function load() {
    var res = await Promise.all([
      sb.from('modules').select('id, title, description, order_index').eq('published', true).order('order_index'),
      sb.rpc('academy_upcoming_modules'),
      sb.from('lessons').select('id, module_id, title, body, video_path, duration_seconds, order_index').eq('published', true).order('order_index'),
      sb.from('lesson_progress').select('lesson_id, completed, completed_at, last_position_seconds').eq('user_id', userId),
    ]);
    res.forEach(function (r) { if (r.error) throw r.error; });
    data = { modules: res[0].data || [], upcoming: res[1].data || [], lessons: res[2].data || [], progress: {} };
    res[3].data.forEach(function (row) { data.progress[row.lesson_id] = row; });
  }

  // Modules in order with their lessons, lock state and counts; plus one flat list of every lesson in order.
  //   module locked  = unpublished, or an earlier module isn't 100% complete (a module with no lessons never is)
  //   lesson open    = its module is unlocked, and it's the first lesson, or it or the one before it is completed
  function build() {
    var mods = data.modules.map(function (m) {
      return { id: m.id, title: m.title, description: m.description, order: m.order_index, published: true, lessons: [] };
    }).concat(data.upcoming.map(function (m) {
      return { id: m.id, title: m.title, description: null, order: m.order_index, published: false, lessons: [] };
    }));
    mods.sort(function (a, b) { return a.order - b.order || String(a.title).localeCompare(String(b.title)); });

    var byModule = {};
    mods.forEach(function (m) { byModule[m.id] = m; });
    data.lessons.forEach(function (l) {
      var m = byModule[l.module_id];
      if (m) m.lessons.push({ id: l.id, title: l.title, body: l.body, videoPath: l.video_path, duration: l.duration_seconds, order: l.order_index, module: m });
    });

    var flat = [], blocked = false;
    mods.forEach(function (m, i) {
      m.number = i + 1;
      m.lessons.sort(function (a, b) { return a.order - b.order; });
      m.locked = !m.published || blocked;
      m.lessons.forEach(function (l, j) {
        var row = data.progress[l.id];
        l.done = !!(row && row.completed);
        l.number = j + 1;
        l.index = flat.length;
        flat.push(l);
      });
      m.lessons.forEach(function (l, j) {
        l.open = !m.locked && (j === 0 || l.done || m.lessons[j - 1].done);
      });
      m.done = m.lessons.filter(function (l) { return l.done; }).length;
      m.total = m.lessons.length;
      m.complete = m.total > 0 && m.done === m.total;
      if (!m.published || !m.complete) blocked = true;
    });

    var byId = {};
    flat.forEach(function (l) { byId[l.id] = l; });
    model = { modules: mods, lessons: flat, byId: byId };
  }

  // The first open lesson not completed yet, else the very first lesson.
  function defaultLesson() {
    return model.lessons.filter(function (l) { return l.open && !l.done; })[0] || model.lessons.filter(function (l) { return l.open; })[0] || null;
  }

  // ---------- video ----------
  // Videos are uploaded from admin.html into the private lesson-videos bucket; lessons.video_path is the object path.
  // Reading needs the storage policy in supabase/admin-schema.sql (section 3).
  async function getVideoUrl(lesson) {
    return lesson.videoPath ? createSignedVideoUrl(lesson.videoPath) : null;
  }

  // A temporary link to a file in the private lesson-videos bucket. expiresInSeconds should outlast one viewing
  // (pauses included); the link stops working after that and is fetched again on the next visit.
  async function createSignedVideoUrl(path, expiresInSeconds) {
    var res = await sb.storage.from('lesson-videos').createSignedUrl(path, expiresInSeconds || 6 * 60 * 60);
    if (res.error) { console.warn('[academy] signed url', res.error); return null; }
    return res.data.signedUrl;
  }

  // ---------- sidebar ----------
  function renderSidebar() {
    var list = $('[data-modules]');
    if (!list) return;
    list.textContent = '';
    if (!model.modules.length) { list.appendChild(el('li', { class: 'side-note', text: T.empty })); return; }

    model.modules.forEach(function (m) {
      var li = el('li', { class: 'mod' + (m.locked ? ' is-locked' : '') + (m.complete ? ' is-complete' : '') });
      var count = m.published && m.total ? fmt(T.lessonsDone, { d: m.done, t: m.total }) : '';
      var num = el('span', { class: 'mod-n', text: String(m.number) });
      var name = el('span', { class: 'mod-t' }, [
        el('small', { text: fmt(T.moduleN, { n: m.number }) }),
        el('span', { text: m.title }),
      ]);

      if (m.locked) {
        // Not a button: nothing to expand or open. The reason is spoken with the title.
        var why = !m.published || !m.total ? T.soon : T.lockedHint;
        li.appendChild(el('div', { class: 'mod-head', 'aria-disabled': 'true', title: why }, [
          num, name,
          el('span', { class: 'mod-lock', html: ICON.lock }),
          el('span', { class: 'sr-only', text: ' (' + T.locked + ': ' + why + ')' }),
        ]));
        list.appendChild(li);
        return;
      }

      var listId = 'mod-' + m.id;
      // expanded by default: the current lesson's module (or, off the lesson page, the one with the next lesson)
      var focusLesson = current || defaultLesson();
      var isOpen = openModules[m.id] !== undefined ? openModules[m.id] : !!(focusLesson && focusLesson.module === m);
      if (isOpen) li.classList.add('is-open');
      var head = el('button', { class: 'mod-head', type: 'button', 'aria-expanded': String(isOpen), 'aria-controls': listId }, [
        num, name,
        count ? el('span', { class: 'mod-count', text: count }) : null,
        el('span', { class: 'mod-chev', html: ICON.chevron }),
      ]);
      head.addEventListener('click', function () {
        var open = head.getAttribute('aria-expanded') !== 'true';
        openModules[m.id] = open;
        head.setAttribute('aria-expanded', String(open));
        li.classList.toggle('is-open', open);
      });
      li.appendChild(head);

      var ol = el('ol', { class: 'lesson-list', id: listId });
      m.lessons.forEach(function (l) {
        var isCurrent = current === l;
        var mark = el('span', { class: 'lesson-mark', html: l.done ? ICON.check : l.open ? '' : ICON.lock });
        var state = l.done ? T.done : isCurrent ? T.current : !l.open ? T.locked : '';
        var label = [mark, el('span', { class: 'lesson-t', text: l.title })];
        if (state) label.push(el('span', { class: 'sr-only', text: ' (' + state + ')' }));
        if (l.duration) label.push(el('span', { class: 'lesson-dur', text: fmt(T.minutes, { m: Math.max(1, Math.round(l.duration / 60)) }) }));
        var cls = 'lesson' + (l.done ? ' is-done' : '') + (isCurrent ? ' is-current' : '') + (l.open ? '' : ' is-locked');
        var item = l.open
          ? el('a', { class: cls, href: lessonHref(l), 'aria-current': isCurrent ? 'page' : null, 'data-lesson': l.id }, label)
          : el('span', { class: cls, 'aria-disabled': 'true', title: T.lessonLockedHint }, label);
        ol.appendChild(el('li', null, [item]));
      });
      li.appendChild(ol);
      list.appendChild(li);
    });
  }

  function sideError(err) {
    console.warn('[academy]', err);
    var list = $('[data-modules]');
    if (list) { list.textContent = ''; list.appendChild(el('li', { class: 'side-note', text: T.loadError })); }
  }

  // ---------- lesson body: blank line = paragraph, "- " = list, "## " = heading, **bold** ----------
  function inline(parent, text) {
    String(text).split(/\*\*(.+?)\*\*/g).forEach(function (part, i) {
      parent.appendChild(i % 2 ? el('strong', { text: part }) : document.createTextNode(part));
    });
  }
  function renderBody(root, text) {
    root.textContent = '';
    String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).forEach(function (block) {
      var lines = block.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      var items = [], para = [];
      function flushPara() { if (!para.length) return; var p = el('p'); para.forEach(function (s, i) { if (i) p.appendChild(el('br')); inline(p, s); }); root.appendChild(p); para = []; }
      function flushList() { if (!items.length) return; var ul = el('ul'); items.forEach(function (s) { var li = el('li'); inline(li, s); ul.appendChild(li); }); root.appendChild(ul); items = []; }
      lines.forEach(function (line) {
        var h = /^#{1,3}\s+(.*)$/.exec(line), li = /^[-*•]\s+(.*)$/.exec(line);
        if (h) { flushPara(); flushList(); root.appendChild(el('h2', { text: h[1] })); }
        else if (li) { flushPara(); items.push(li[1]); }
        else { flushList(); para.push(line); }
      });
      flushPara(); flushList();
    });
  }

  // ---------- academy page ----------
  function show(view) {
    $$('[data-view]').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== view; });
  }

  // Resolve ?lesson=<id>. A missing, unknown or still locked lesson redirects to the default one.
  function route(focus) {
    var id = new URLSearchParams(location.search).get('lesson');
    var lesson = id && model.byId[id];
    if (!lesson || !lesson.open) {
      lesson = defaultLesson();
      if (!lesson) { current = null; renderSidebar(); show('empty'); return; }
      history.replaceState(null, '', lessonHref(lesson));
    }
    current = lesson;
    renderSidebar();
    renderLesson(focus);
  }

  function navTo(lesson) {
    history.pushState(null, '', lessonHref(lesson));
    route(true);
    window.scrollTo(0, 0);
  }

  var videoToken = 0;
  function renderLesson(focus) {
    var l = current, m = l.module;
    show('lesson');
    document.title = l.title + ' – RoboSTEAM';
    $('[data-crumb]').textContent = fmt(T.moduleN, { n: m.number }) + ' · ' + m.title + ' · ' + fmt(T.lessonN, { n: l.number });
    var title = $('[data-title]');
    title.textContent = l.title;
    if (focus) title.focus();
    renderBody($('[data-body]'), l.body);
    renderQuiz(l);
    say('');

    // Video: the <video> shows the placeholder poster and the overlay until getVideoUrl returns a URL.
    var video = $('[data-video]'), overlay = $('[data-video-soon]'), token = ++videoToken;
    video.pause();
    video.removeAttribute('src');
    video.removeAttribute('controls');
    video.load();
    overlay.hidden = false;
    getVideoUrl(l).then(function (url) {
      if (!url || token !== videoToken) return;
      video.src = url;
      video.controls = true;
      overlay.hidden = true;
    }, function (err) { console.warn('[academy] video', err); });

    renderActions();
  }

  // Complete button and Previous / Next. Next stays disabled until this lesson is completed.
  function renderActions() {
    var l = current, btn = $('[data-complete]');
    btn.disabled = l.done;
    btn.classList.toggle('is-done', l.done);
    btn.innerHTML = l.done ? ICON.check : '';
    btn.appendChild(document.createTextNode(l.done ? T.completed : T.markComplete));

    var prev = model.lessons[l.index - 1], next = model.lessons[l.index + 1];
    setLink($('[data-prev]'), prev && prev.open ? prev : null);
    setLink($('[data-next]'), l.done && next && next.open ? next : null);
    var hint = $('[data-next-hint]');
    hint.textContent = !l.done ? T.nextHint : (!next || !next.open) ? T.lastLesson : '';
    hint.hidden = !hint.textContent;
  }

  function setLink(a, lesson) {
    if (lesson) {
      a.href = lessonHref(lesson);
      a.setAttribute('data-lesson', lesson.id);
      a.removeAttribute('aria-disabled');
      a.title = lesson.title;
    } else {
      a.removeAttribute('href');
      a.removeAttribute('data-lesson');
      a.setAttribute('aria-disabled', 'true');
      a.removeAttribute('title');
    }
  }

  function say(text, kind) {
    var msg = $('[data-complete-msg]');
    msg.textContent = text || '';
    msg.hidden = !text;
    msg.className = 'form-msg' + (text ? ' is-' + (kind || 'error') : '');
  }

  async function markComplete() {
    var btn = $('[data-complete]'), l = current;
    if (btn.disabled || l.done) return;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    say('');
    try {
      // completed_at / updated_at are set by the lesson_progress_touch trigger (database clock)
      var res = await sb.from('lesson_progress')
        .upsert({ user_id: userId, lesson_id: l.id, completed: true }, { onConflict: 'user_id,lesson_id' })
        .select('lesson_id, completed, completed_at, last_position_seconds')
        .single();
      if (res.error) throw res.error;
      data.progress[l.id] = res.data;
      build();
      current = model.byId[l.id];
      renderSidebar();
      renderActions();
      var next = $('[data-next]');
      if (!next.hasAttribute('aria-disabled')) next.focus();
    } catch (err) {
      console.warn('[academy] complete', err);
      say(T.saveError, 'error');
      btn.disabled = false;
    } finally {
      btn.removeAttribute('aria-busy');
    }
  }

  // ---------- lesson quiz: questions come without answers; the database checks them (supabase/admin-schema.sql) ----------
  var quiz = null, quizToken = 0; // quiz = { lessonId, questions: [{ id, prompt, options }] }

  async function renderQuiz(lesson) {
    var box = $('[data-quiz]'), token = ++quizToken;
    box.hidden = true;
    quiz = null;
    try {
      var res = await sb.rpc('quiz_for_lesson', { p_lesson_id: lesson.id });
      if (res.error) throw res.error;
      if (token !== quizToken || !res.data || !res.data.length) return;
      quiz = { lessonId: lesson.id, questions: res.data };
      drawQuiz();
      box.hidden = false;
    } catch (err) {
      console.warn('[academy] quiz', err); // no quiz is shown; the lesson itself still works
    }
  }

  function drawQuiz() {
    var list = $('[data-quiz-list]');
    list.textContent = '';
    quiz.questions.forEach(function (q, i) {
      var fs = el('fieldset', { class: 'quiz-q', 'data-q': q.id }, [
        el('legend', null, [el('span', { class: 'quiz-n', text: fmt(T.questionN, { n: i + 1 }) }), el('span', { text: q.prompt })]),
      ]);
      q.options.forEach(function (opt, j) {
        var id = 'q-' + q.id + '-' + j;
        fs.appendChild(el('label', { class: 'quiz-opt', for: id }, [
          el('input', { type: 'radio', id: id, name: 'q-' + q.id, value: String(j) }),
          el('span', { class: 'quiz-opt-t', text: opt }),
        ]));
      });
      list.appendChild(el('li', null, [fs]));
    });
    quizSay('');
    $('[data-quiz-submit]').hidden = false;
    $('[data-quiz-submit]').disabled = false;
    $('[data-quiz-retry]').hidden = true;
  }

  function quizSay(text, kind) {
    var msg = $('[data-quiz-msg]');
    msg.textContent = text || '';
    msg.hidden = !text;
    msg.className = 'form-msg' + (text ? ' is-' + (kind || 'error') : '');
    msg.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }

  async function submitQuiz(e) {
    e.preventDefault();
    var btn = $('[data-quiz-submit]');
    if (!quiz || btn.disabled) return;
    var answers = {}, missing = null, lessonId = quiz.lessonId;
    quiz.questions.forEach(function (q) {
      var picked = $('input[name="q-' + q.id + '"]:checked');
      if (picked) answers[q.id] = Number(picked.value);
      else if (!missing) missing = q;
    });
    if (missing) {
      quizSay(T.quizAnswerAll, 'error');
      $('input[name="q-' + missing.id + '"]').focus();
      return;
    }
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    quizSay('');
    try {
      var res = await sb.rpc('submit_quiz', { p_lesson_id: lessonId, p_answers: answers });
      if (res.error) throw res.error;
      if (!quiz || quiz.lessonId !== lessonId) return; // switched lessons meanwhile
      showQuizResult(res.data, answers);
    } catch (err) {
      console.warn('[academy] quiz submit', err);
      quizSay(T.quizError, 'error');
      btn.disabled = false;
    } finally {
      btn.removeAttribute('aria-busy');
    }
  }

  // Marks the right option of every question and the wrong picks, then offers a retry.
  function showQuizResult(result, answers) {
    (result.results || []).forEach(function (r) {
      var fs = $('[data-q="' + r.id + '"]');
      if (!fs) return;
      fs.classList.add(r.correct ? 'is-right' : 'is-wrong');
      $$('.quiz-opt', fs).forEach(function (label, j) {
        var input = $('input', label);
        input.disabled = true;
        var mark = j === r.correct_index ? 'right' : j === answers[r.id] ? 'wrong' : '';
        if (!mark) return;
        label.classList.add('is-' + mark);
        label.appendChild(el('span', { class: 'quiz-tag', text: T[mark] }));
      });
    });
    var perfect = result.total > 0 && result.score === result.total;
    quizSay((perfect ? T.quizPerfect + ' ' : '') + fmt(T.quizScore, { s: result.score, t: result.total }), perfect ? 'ok' : 'info');
    $('[data-quiz-submit]').hidden = true;
    var retry = $('[data-quiz-retry]');
    retry.hidden = false;
    retry.focus();
  }

  function academy() {
    $('[data-complete]').addEventListener('click', markComplete);
    $('[data-quiz-form]').addEventListener('submit', submitQuiz);
    $('[data-quiz-retry]').addEventListener('click', function () {
      drawQuiz();
      var first = $('[data-quiz-list] input');
      if (first) first.focus();
    });
    // Lesson links (sidebar, Previous / Next) switch lessons in place; modified clicks still open a new tab.
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-lesson]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var lesson = model && model.byId[a.getAttribute('data-lesson')];
      if (!lesson || !lesson.open) return;
      e.preventDefault();
      if (lesson !== current) navTo(lesson);
    });
    window.addEventListener('popstate', function () { if (model) route(true); });
    return function () { route(false); };
  }

  // ---------- progress page ----------
  function bar(pct, cls) {
    return el('div', { class: 'bar' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, [el('i', { style: 'width:' + pct + '%' })]);
  }
  function pctOf(d, t) { return t ? Math.round((d / t) * 100) : 0; }

  function progress() {
    return function () {
      renderSidebar();
      var total = model.lessons.length;
      var done = model.lessons.filter(function (l) { return l.done; }).length;
      var pct = pctOf(done, total);
      $('[data-progress-empty]').hidden = done > 0;
      $('[data-total-line]').textContent = fmt(T.progressLine, { d: done, t: total });
      $('[data-total-pct]').textContent = pct + '%';
      var totalBar = $('[data-total-bar]');
      totalBar.setAttribute('aria-valuenow', String(pct));
      totalBar.setAttribute('aria-valuetext', fmt(T.progressLine, { d: done, t: total }));
      $('i', totalBar).style.width = pct + '%';

      var list = $('[data-module-progress]');
      list.textContent = '';
      model.modules.forEach(function (m) {
        var p = pctOf(m.done, m.total), soon = !m.published || !m.total;
        var status = soon ? T.soon : m.locked ? T.locked : fmt(T.progressModule, { d: m.done, t: m.total, p: p });
        list.appendChild(el('li', { class: 'prog-mod' + (m.locked ? ' is-locked' : '') + (m.complete ? ' is-complete' : '') }, [
          el('div', { class: 'prog-head' }, [
            el('span', { class: 'mod-n', text: String(m.number) }),
            el('span', { class: 'prog-t', text: m.title }),
            m.locked ? el('span', { class: 'mod-lock', html: ICON.lock }) : null,
          ]),
          bar(soon ? 0 : p, m.complete ? 'is-complete' : ''),
          el('p', { class: 'prog-status', text: status }),
        ]));
      });
      show('progress');
    };
  }

  // ---------- dashboard ----------
  function dashboard() {
    return function () {
      var total = model.lessons.length;
      var done = model.lessons.filter(function (l) { return l.done; }).length;
      var published = model.modules.filter(function (m) { return m.published && m.total; });
      var modsDone = published.filter(function (m) { return m.complete; }).length;
      var pct = pctOf(done, total);

      // Continue learning: the next open lesson, or a friendly state when there's nothing (left) to do
      var next = model.lessons.filter(function (l) { return l.open && !l.done; })[0];
      var card = $('[data-continue]');
      var h = $('[data-next-title]', card), meta = $('[data-next-meta]', card), line = $('[data-next-line]', card);
      var barEl = $('[data-next-bar]', card), cta = $('[data-next-cta]', card);
      barEl.hidden = line.hidden = meta.hidden = !next;
      if (next) {
        var m = next.module, mp = pctOf(m.done, m.total);
        meta.textContent = fmt(T.nextIn, { m: fmt(T.moduleN, { n: m.number }), l: fmt(T.lessonN, { n: next.number }) }) + ' · ' + m.title;
        h.textContent = next.title;
        line.textContent = fmt(T.moduleProgress, { d: m.done, t: m.total });
        barEl.setAttribute('aria-valuenow', String(mp));
        barEl.setAttribute('aria-valuetext', line.textContent);
        $('i', barEl).style.width = mp + '%';
        cta.href = lessonHref(next);
        cta.textContent = done ? T.continueBtn : T.startFirst;
        cta.hidden = false;
      } else if (total) {
        h.textContent = T.allDone;
        line.hidden = false;
        line.textContent = T.allDoneText;
        cta.href = 'progress.html';
        cta.textContent = T.seeProgress;
        cta.hidden = false;
      } else {
        h.textContent = T.noLessons;
        line.hidden = false;
        line.textContent = T.noLessonsText;
        cta.hidden = true;
      }

      $('[data-stat-lessons]').textContent = fmt(T.statLessons, { d: done, t: total });
      $('[data-stat-modules]').textContent = fmt(T.statModules, { d: modsDone, t: published.length });
      $('[data-stat-pct]').textContent = pct + '%';
      $('[data-stats-empty]').textContent = T.statsEmpty;
      $('[data-stats-empty]').hidden = done > 0 || !total;
      show('dash');
    };
  }

  // ---------- start ----------
  function currentPath() { return location.pathname.split('/').pop() + location.search; }

  // [data-needs-data] blocks (dashboard cards) show placeholders while loading and hide when loading fails
  function needsData(visible) { $$('[data-needs-data]').forEach(function (n) { n.hidden = !visible; }); }

  async function start(render) {
    show('loading');
    needsData(true);
    try {
      await load();
      build();
      render();
    } catch (err) {
      sideError(err);
      show('error');
      needsData(false);
    }
  }

  if (!sb) { location.replace('login.html'); return; }

  sb.auth.getSession().then(function (res) {
    var session = res && res.data ? res.data.session : null;
    if (!session) { location.replace('login.html?next=' + encodeURIComponent(currentPath())); return; }
    userId = session.user.id;
    document.body.removeAttribute('data-guard');
    var render = page === 'academy' ? academy() : page === 'progress' ? progress() : page === 'dashboard' ? dashboard() : null;
    if (!render) return;
    var retry = $('[data-retry]');
    if (retry) retry.addEventListener('click', function () { start(render); });
    start(render);
  }, function (err) {
    console.warn('[academy]', err);
    location.replace('login.html');
  });
})();
