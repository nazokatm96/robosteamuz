/* RoboSTEAM admin panel (admin.html), admins only:
     Darslar           modules and lessons: add, edit, order, drafts, video upload (private lesson-videos bucket), quizzes
     Foydalanuvchilar  everyone who signed up, their progress; set a new password, confirm an email
     So'rovnoma        survey.html answers, with a CSV export
   The page asks is_admin() first, but the database enforces every rule again (supabase/admin-schema.sql). Passwords and
   email confirmation need the service role, so they go through the admin-users Edge Function
   (supabase/functions/admin-users). js/app.js still does the route guard and the user card. Every user-facing string is in T. */
(function () {
  'use strict';

  var T = {
    saveError: "Saqlab bo'lmadi. Qayta urinib ko'ring.",
    saved: 'Saqlandi.',
    deleted: "O'chirildi.",
    dash: '—',
    draft: 'Qoralama',
    // content
    moduleN: '{n}-modul',
    lessonN: '{n}.',
    lessonsCount: '{n} ta dars',
    noModules: "Hali modul yo'q. «+ Modul qo'shish» tugmasidan boshlang.",
    noLessons: "Bu modulda hali dars yo'q.",
    newModule: 'Yangi modul',
    editModule: 'Modulni tahrirlash',
    newLessonTitle: 'Yangi dars',
    moduleSaved: '«{t}» moduli saqlandi.',
    lessonSaved: '«{t}» darsi saqlandi.',
    hasVideo: 'Video',
    noVideo: "Video yo'q",
    quizCount: 'Test: {n}',
    up: 'Yuqoriga',
    down: 'Pastga',
    edit: 'Tahrirlash',
    addLesson: '+ Dars',
    moveUp: '«{t}»: yuqoriga',
    moveDown: '«{t}»: pastga',
    editNamed: '«{t}»: tahrirlash',
    addLessonTo: "«{t}» moduliga dars qo'shish",
    confirmDeleteModule: "«{t}» moduli va undagi {n} ta dars (videolari, testlari va o'quvchilar natijalari bilan) butunlay o'chiriladi. Davom etasizmi?",
    confirmDeleteLesson: "«{t}» darsi (videosi, testi va o'quvchilar natijalari bilan) butunlay o'chiriladi. Davom etasizmi?",
    titleRequired: 'Nomini yozing.',
    // video
    videoNone: 'Bu darsga hali video yuklanmagan.',
    videoReady: 'Video yuklangan · {d}',
    videoReadyNoDur: 'Video yuklangan',
    videoPick: 'Video tanlash',
    videoReplace: 'Boshqa video yuklash',
    videoUploading: 'Yuklanmoqda… {p}%',
    videoSaving: 'Saqlanmoqda…',
    videoUploaded: 'Video yuklandi va darsga biriktirildi.',
    videoRemoved: "Video o'chirildi.",
    videoHint: "MP4 yoki WebM, eng ko'pi {m} MB. Video darhol saqlanadi, «Saqlash» shart emas.",
    videoType: 'Faqat MP4 yoki WebM video yuklash mumkin.',
    videoTooBig: "Fayl juda katta ({s} MB). Eng ko'pi {m} MB. Videoni siqib (masalan, 720p) qayta yuklang.",
    videoServerTooBig: "Supabase faylni qabul qilmadi: u loyihaning fayl hajmi chegarasidan katta (Storage sozlamalari). Videoni siqib qayta yuklang.",
    videoError: "Videoni yuklab bo'lmadi. Qayta urinib ko'ring.",
    videoCancelled: 'Yuklash bekor qilindi.',
    confirmRemoveVideo: "Darsdagi video o'chirilsinmi?",
    confirmCloseUpload: "Video hali yuklanmoqda. Yuklash bekor qilinsinmi?",
    // quiz editor
    questionN: '{n}-savol',
    optionN: '{n}-variant',
    correctLabel: "{n}-variant to'g'ri",
    removeOption: '{n}-variantni olib tashlash',
    addOption: "+ Variant",
    removeQuestion: "Savolni o'chirish",
    noQuestions: "Bu darsda test yo'q. Savol qo'shsangiz, dars matni ostida test paydo bo'ladi.",
    quizPromptMissing: 'Savol matnini yozing.',
    quizOptionMissing: "Bo'sh variantni to'ldiring yoki olib tashlang.",
    // users
    usersCount: '{n} ta foydalanuvchi',
    usersFound: '{n} / {t} ta foydalanuvchi',
    noUsers: 'Hech kim topilmadi.',
    adminBadge: 'Admin',
    unconfirmed: 'Tasdiqlanmagan',
    never: 'Kirmagan',
    lessonsDone: '{d} / {t}',
    setPassword: 'Parol',
    setPasswordFor: "{n}: parolni o'zgartirish",
    confirmEmail: 'Tasdiqlash',
    confirmEmailFor: '{n}: emailni tasdiqlash',
    pwUser: '{n} ({e}) uchun yangi parol.',
    passwordSet: "{n} uchun yangi parol saqlandi. Uni foydalanuvchiga xavfsiz yo'l bilan yetkazing.",
    emailConfirmed: '{n} emaili tasdiqlandi, endi u tizimga kira oladi.',
    fnUnavailable: "admin-users server funksiyasi javob bermadi. U Supabase'da o'rnatilganini tekshiring (supabase/functions/admin-users).",
    forbidden: 'Bu amal faqat adminlar uchun.',
    // survey
    surveyCount: '{n} ta javob',
    noSurvey: "Hali javob yo'q.",
    roles: { student: "O'quvchi", teacher: "O'qituvchi" },
    csvName: 'sorovnoma-{d}.csv',
    csvCols: ['Sana', 'Rol', 'Ism', 'Telefon', 'Yosh', 'Viloyat'],
    // dates (built by hand: browsers' Uzbek date formats are incomplete)
    date: '{y}-yil {d}-{m}',
    months: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  };

  // Supabase Free plan: 50 MB per file. On Pro, raise the project's upload limit (Storage settings) and this number.
  var MAX_VIDEO_MB = 50;
  var VIDEO_TYPES = ['video/mp4', 'video/webm'];
  var BUCKET = 'lesson-videos';

  var A = window.RSAuth, sb = window.sb || null, cfg = window.ROBOSTEAM_CONFIG || {};
  var ICON = {
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  };

  var content = { modules: [], lessons: [], quizCounts: {} };
  var users = null, survey = null;
  var busy = false; // one content change at a time (reorders, deletes)

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
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function formatDate(iso, withTime) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return T.dash;
    var s = fmt(T.date, { y: d.getFullYear(), d: d.getDate(), m: T.months[d.getMonth()] });
    return withTime ? s + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : s;
  }
  function formatDuration(sec) {
    if (!sec && sec !== 0) return '';
    sec = Math.round(sec);
    return Math.floor(sec / 60) + ':' + pad(sec % 60);
  }
  function show(view) {
    $$('[data-view]').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== view; });
  }
  function byOrder(a, b) { return a.order_index - b.order_index || String(a.title).localeCompare(String(b.title)); }
  function lessonsOf(moduleId) { return content.lessons.filter(function (l) { return l.module_id === moduleId; }).sort(byOrder); }
  function sortedModules() { return content.modules.slice().sort(byOrder); }
  function nextOrder(list) { return list.reduce(function (m, x) { return Math.max(m, x.order_index); }, 0) + 1; }
  function check(res) { if (res.error) throw res.error; return res.data; }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
      return (c === 'x' ? r : (r & 3) | 8).toString(16);
    });
  }

  // ---------- dialogs ----------
  function openDialog(d) {
    $$('.form-msg', d).forEach(function (m) { A.say(m, ''); });
    $$('.field-error', d).forEach(function (p) { p.hidden = true; });
    $$('[aria-invalid]', d).forEach(function (i) { i.removeAttribute('aria-invalid'); });
    d.showModal();
  }
  $$('dialog').forEach(function (d) {
    d.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) d.close();
    });
  });

  // ======================================================================================================
  // Darslar: modules and lessons
  // ======================================================================================================
  async function loadContent() {
    var res = await Promise.all([
      sb.from('modules').select('id, title, description, order_index, published'),
      sb.from('lessons').select('id, module_id, title, body, video_path, duration_seconds, order_index, published'),
      sb.from('quiz_questions').select('lesson_id'),
    ]);
    content.modules = check(res[0]) || [];
    content.lessons = check(res[1]) || [];
    content.quizCounts = {};
    (check(res[2]) || []).forEach(function (q) { content.quizCounts[q.lesson_id] = (content.quizCounts[q.lesson_id] || 0) + 1; });
  }

  function contentSay(text, kind) { A.say($('[data-content-msg]'), text, kind); }

  function iconBtn(name, label, attrs) {
    return el('button', Object.assign({ class: 'icon-btn adm-icon', type: 'button', 'aria-label': label, title: label, html: ICON[name] }, attrs));
  }
  function badge(text, cls) { return el('span', { class: 'adm-badge' + (cls ? ' ' + cls : ''), text: text }); }

  // focusKey: re-focus the button with this data-key after re-rendering (e.g. after moving an item)
  function renderContent(focusKey) {
    var list = $('[data-mods]');
    list.textContent = '';
    var mods = sortedModules();
    if (!mods.length) list.appendChild(el('li', { class: 'empty-note', text: T.noModules }));

    mods.forEach(function (m, i) {
      var lessons = lessonsOf(m.id);
      var head = el('div', { class: 'adm-row adm-mod-head' }, [
        el('span', { class: 'mod-n', text: String(i + 1) }),
        el('div', { class: 'adm-main' }, [
          el('small', { text: fmt(T.moduleN, { n: i + 1 }) + ' · ' + fmt(T.lessonsCount, { n: lessons.length }) }),
          el('strong', { text: m.title }),
        ]),
        m.published ? null : badge(T.draft, 'is-draft'),
        el('div', { class: 'adm-acts' }, [
          iconBtn('up', fmt(T.moveUp, { t: m.title }), { 'data-move-module': m.id, 'data-dir': '-1', 'data-key': 'mu:' + m.id, disabled: i === 0 }),
          iconBtn('down', fmt(T.moveDown, { t: m.title }), { 'data-move-module': m.id, 'data-dir': '1', 'data-key': 'md:' + m.id, disabled: i === mods.length - 1 }),
          el('button', { class: 'btn ghost sm', type: 'button', 'data-edit-module': m.id, 'aria-label': fmt(T.editNamed, { t: m.title }), text: T.edit }),
          el('button', { class: 'btn sm', type: 'button', 'data-add-lesson': m.id, 'aria-label': fmt(T.addLessonTo, { t: m.title }), text: T.addLesson }),
        ]),
      ]);

      var ol = el('ol', { class: 'adm-lessons' });
      if (!lessons.length) ol.appendChild(el('li', { class: 'adm-empty', text: T.noLessons }));
      lessons.forEach(function (l, j) {
        var quizN = content.quizCounts[l.id] || 0;
        ol.appendChild(el('li', { class: 'adm-row adm-lesson' }, [
          el('span', { class: 'adm-ln', text: fmt(T.lessonN, { n: j + 1 }) }),
          el('div', { class: 'adm-main' }, [
            el('span', { class: 'adm-lt', text: l.title }),
            el('span', { class: 'adm-tags' }, [
              l.video_path ? badge(T.hasVideo + (l.duration_seconds ? ' · ' + formatDuration(l.duration_seconds) : ''), 'is-ok') : badge(T.noVideo, 'is-muted'),
              quizN ? badge(fmt(T.quizCount, { n: quizN }), 'is-ok') : null,
              l.published ? null : badge(T.draft, 'is-draft'),
            ]),
          ]),
          el('div', { class: 'adm-acts' }, [
            iconBtn('up', fmt(T.moveUp, { t: l.title }), { 'data-move-lesson': l.id, 'data-dir': '-1', 'data-key': 'lu:' + l.id, disabled: j === 0 }),
            iconBtn('down', fmt(T.moveDown, { t: l.title }), { 'data-move-lesson': l.id, 'data-dir': '1', 'data-key': 'ld:' + l.id, disabled: j === lessons.length - 1 }),
            el('button', { class: 'btn ghost sm', type: 'button', 'data-edit-lesson': l.id, 'data-key': 'le:' + l.id, 'aria-label': fmt(T.editNamed, { t: l.title }), text: T.edit }),
          ]),
        ]));
      });

      list.appendChild(el('li', { class: 'adm-mod' + (m.published ? '' : ' is-draft') }, [head, ol]));
    });

    if (focusKey) focusIn($('[data-key="' + focusKey + '"]'));
  }

  // Focus a button; if it's disabled (e.g. "up" on what is now the first row), the first enabled one next to it.
  function focusIn(target) {
    if (target && target.disabled) target = $('button:not([disabled])', target.parentNode);
    if (target) target.focus();
  }

  // Swap with the neighbour, then write order_index 1..n for every row whose position changed.
  async function move(table, list, item, dir, focusKey) {
    var i = list.indexOf(item), j = i + dir;
    if (busy || j < 0 || j >= list.length) return;
    busy = true;
    contentSay('');
    var arr = list.slice();
    arr[i] = arr[j];
    arr[j] = item;
    try {
      var changed = arr.map(function (x, k) { return { row: x, order: k + 1 }; }).filter(function (c) { return c.row.order_index !== c.order; });
      var res = await Promise.all(changed.map(function (c) { return sb.from(table).update({ order_index: c.order }).eq('id', c.row.id); }));
      res.forEach(check);
      changed.forEach(function (c) { c.row.order_index = c.order; });
    } catch (err) {
      console.warn('[admin] move', err);
      contentSay(T.saveError, 'error');
    } finally {
      busy = false;
      renderContent(focusKey);
    }
  }

  function contentClicks(e) {
    var b = e.target.closest('button');
    if (!b || b.disabled) return;
    var id;
    if ((id = b.getAttribute('data-move-module'))) {
      var m = content.modules.filter(function (x) { return x.id === id; })[0];
      move('modules', sortedModules(), m, Number(b.getAttribute('data-dir')), b.getAttribute('data-key'));
    } else if ((id = b.getAttribute('data-move-lesson'))) {
      var l = lessonById(id);
      move('lessons', lessonsOf(l.module_id), l, Number(b.getAttribute('data-dir')), b.getAttribute('data-key'));
    } else if ((id = b.getAttribute('data-edit-module'))) {
      openModule(content.modules.filter(function (x) { return x.id === id; })[0], b);
    } else if ((id = b.getAttribute('data-add-lesson'))) {
      addLesson(id, b);
    } else if ((id = b.getAttribute('data-edit-lesson'))) {
      openLesson(lessonById(id), b);
    } else if (b.hasAttribute('data-add-module')) {
      openModule(null, b);
    }
  }
  function lessonById(id) { return content.lessons.filter(function (x) { return x.id === id; })[0]; }

  // ---------- module dialog ----------
  var modDialog = $('#module-dialog'), editingModule = null, modOpener = null;

  function openModule(m, opener) {
    editingModule = m;
    modOpener = opener;
    $('[data-module-h]').textContent = m ? T.editModule : T.newModule;
    $('#m-title').value = m ? m.title : '';
    $('#m-desc').value = m ? m.description || '' : '';
    $('#m-published').checked = m ? m.published : false;
    $('[data-delete-module]').hidden = !m;
    openDialog(modDialog);
  }
  // Save and delete re-render the list and move focus themselves (they clear modOpener first).
  modDialog.addEventListener('close', function () { if (modOpener && document.contains(modOpener)) modOpener.focus(); });

  $('[data-module-form]').addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = $('[type=submit]', this), msg = $('[data-module-msg]'), title = $('#m-title');
    if (btn.disabled) return;
    if (!A.check([[title, function () { return title.value.trim() ? '' : T.titleRequired; }]])) return;
    var row = { title: title.value.trim(), description: $('#m-desc').value.trim() || null, published: $('#m-published').checked };
    A.setBusy(btn, true);
    try {
      var m = editingModule;
      if (m) {
        check(await sb.from('modules').update(row).eq('id', m.id));
        Object.assign(m, row);
      } else {
        row.order_index = nextOrder(content.modules);
        m = check(await sb.from('modules').insert(row).select('id, title, description, order_index, published').single());
        content.modules.push(m);
      }
      modOpener = null;
      modDialog.close();
      renderContent();
      focusIn($('[data-edit-module="' + m.id + '"]'));
      contentSay(fmt(T.moduleSaved, { t: row.title }), 'ok');
    } catch (err) {
      console.warn('[admin] module', err);
      A.say(msg, T.saveError, 'error');
    } finally {
      A.setBusy(btn, false);
    }
  });

  $('[data-delete-module]').addEventListener('click', async function () {
    var m = editingModule, btn = this;
    if (!m || btn.disabled) return;
    var lessons = lessonsOf(m.id);
    if (!window.confirm(fmt(T.confirmDeleteModule, { t: m.title, n: lessons.length }))) return;
    A.setBusy(btn, true);
    try {
      check(await sb.from('modules').delete().eq('id', m.id)); // lessons, quizzes and progress go with it (cascade)
      removeVideos(lessons.map(function (l) { return l.video_path; }));
      content.modules = content.modules.filter(function (x) { return x !== m; });
      content.lessons = content.lessons.filter(function (l) { return l.module_id !== m.id; });
      modOpener = null;
      modDialog.close();
      renderContent();
      $('[data-add-module]').focus();
      contentSay(T.deleted, 'ok');
    } catch (err) {
      console.warn('[admin] delete module', err);
      A.say($('[data-module-msg]'), T.saveError, 'error');
    } finally {
      A.setBusy(btn, false);
    }
  });

  // Files are removed after their rows: a failure here only leaves an unused file behind, never a broken lesson.
  function removeVideos(paths) {
    paths = paths.filter(Boolean);
    if (!paths.length) return;
    sb.storage.from(BUCKET).remove(paths).then(function (r) { if (r.error) console.warn('[admin] remove videos', r.error); });
  }

  // ---------- lessons ----------
  // A new lesson is created right away as a draft, so the video can be uploaded under its id before the first save.
  async function addLesson(moduleId, opener) {
    if (busy) return;
    busy = true;
    contentSay('');
    try {
      var row = { module_id: moduleId, title: T.newLessonTitle, published: false, order_index: nextOrder(lessonsOf(moduleId)) };
      var l = check(await sb.from('lessons').insert(row).select('id, module_id, title, body, video_path, duration_seconds, order_index, published').single());
      content.lessons.push(l);
      renderContent();
      openLesson(l, $('[data-key="le:' + l.id + '"]') || opener);
      $('#l-title').select();
    } catch (err) {
      console.warn('[admin] add lesson', err);
      contentSay(T.saveError, 'error');
    } finally {
      busy = false;
    }
  }

  var lesDialog = $('#lesson-dialog'), editing = null, lesOpener = null;
  var questions = [], savedQuestionIds = []; // quiz editor state for the open lesson

  async function openLesson(l, opener) {
    editing = l;
    lesOpener = opener;
    var sel = $('#l-module');
    sel.textContent = '';
    sortedModules().forEach(function (m, i) {
      sel.appendChild(el('option', { value: m.id, text: fmt(T.moduleN, { n: i + 1 }) + ' · ' + m.title }));
    });
    sel.value = l.module_id;
    $('#l-title').value = l.title;
    $('#l-body').value = l.body || '';
    $('#l-published').checked = l.published;
    $('[data-video-hint]').textContent = fmt(T.videoHint, { m: MAX_VIDEO_MB });
    questions = [];
    savedQuestionIds = [];
    renderQuizEditor();
    renderVideo();
    openDialog(lesDialog);

    try {
      var rows = check(await sb.from('quiz_questions').select('id, prompt, options, correct_index, order_index').eq('lesson_id', l.id).order('order_index'));
      if (editing !== l) return;
      questions = rows.map(function (q) { return { id: q.id, prompt: q.prompt, options: q.options.slice(), correct: q.correct_index }; });
      savedQuestionIds = rows.map(function (q) { return q.id; });
      renderQuizEditor();
    } catch (err) {
      console.warn('[admin] quiz load', err);
      A.say($('[data-lesson-msg]'), T.saveError, 'error');
    }
  }

  // Closing during an upload asks first, and stops the upload right away when confirmed.
  function stopUploadToClose() {
    if (!upload) return true;
    if (!window.confirm(T.confirmCloseUpload)) return false;
    upload.abort();
    return true;
  }
  lesDialog.addEventListener('cancel', function (e) { if (!stopUploadToClose()) e.preventDefault(); }); // Escape
  lesDialog.addEventListener('click', function (e) {
    // capture phase: runs before the generic [data-close] handler, which it can stop
    if (e.target.closest('[data-close]') && !stopUploadToClose()) e.stopImmediatePropagation();
  }, true);
  // Save and delete move focus themselves (they clear lesOpener first). Otherwise back to the opener, or to the
  // lesson's edit button if the list was re-rendered meanwhile (e.g. after a video upload).
  lesDialog.addEventListener('close', function () {
    if (upload) upload.abort();
    var p = $('[data-video-preview]');
    p.pause();
    p.removeAttribute('src');
    p.load();
    var id = editing && editing.id;
    editing = null;
    if (!lesOpener) return;
    focusIn(document.contains(lesOpener) ? lesOpener : $('[data-key="le:' + id + '"]'));
  });

  $('[data-lesson-form]').addEventListener('submit', async function (e) {
    e.preventDefault();
    var l = editing, btn = $('[type=submit]', this), msg = $('[data-lesson-msg]'), title = $('#l-title');
    if (!l || btn.disabled) return;
    A.say(msg, '');
    if (!A.check([[title, function () { return title.value.trim() ? '' : T.titleRequired; }]])) return;
    if (!validateQuiz()) return;

    var row = { title: title.value.trim(), body: $('#l-body').value.replace(/\s+$/, '') || null, published: $('#l-published').checked };
    var moduleId = $('#l-module').value;
    if (moduleId !== l.module_id) { row.module_id = moduleId; row.order_index = nextOrder(lessonsOf(moduleId)); }
    var qRows = questions.map(function (q, i) {
      return { id: q.id, lesson_id: l.id, prompt: q.prompt.trim(), options: q.options.map(function (o) { return o.trim(); }), correct_index: q.correct, order_index: i + 1 };
    });
    var keep = qRows.map(function (q) { return q.id; });
    var removed = savedQuestionIds.filter(function (id) { return keep.indexOf(id) < 0; });

    A.setBusy(btn, true);
    try {
      check(await sb.from('lessons').update(row).eq('id', l.id));
      Object.assign(l, row);
      if (removed.length) check(await sb.from('quiz_questions').delete().in('id', removed));
      if (qRows.length) check(await sb.from('quiz_questions').upsert(qRows));
      savedQuestionIds = keep;
      content.quizCounts[l.id] = qRows.length;
      lesOpener = null;
      lesDialog.close();
      renderContent('le:' + l.id);
      contentSay(fmt(T.lessonSaved, { t: l.title }), 'ok');
    } catch (err) {
      console.warn('[admin] lesson save', err);
      A.say(msg, T.saveError, 'error');
    } finally {
      A.setBusy(btn, false);
    }
  });

  $('[data-delete-lesson]').addEventListener('click', async function () {
    var l = editing, btn = this;
    if (!l || btn.disabled || upload) return;
    if (!window.confirm(fmt(T.confirmDeleteLesson, { t: l.title }))) return;
    A.setBusy(btn, true);
    try {
      check(await sb.from('lessons').delete().eq('id', l.id)); // quiz and progress go with it (cascade)
      removeVideos([l.video_path]);
      content.lessons = content.lessons.filter(function (x) { return x !== l; });
      delete content.quizCounts[l.id];
      lesOpener = null;
      lesDialog.close();
      renderContent();
      focusIn($('[data-add-lesson="' + l.module_id + '"]'));
      contentSay(T.deleted, 'ok');
    } catch (err) {
      console.warn('[admin] delete lesson', err);
      A.say($('[data-lesson-msg]'), T.saveError, 'error');
    } finally {
      A.setBusy(btn, false);
    }
  });

  // ---------- video: uploaded straight to Storage with progress, then attached to the lesson ----------
  var upload = null; // { xhr, abort } while a file is uploading

  function videoSay(text, kind) { A.say($('[data-video-msg]'), text, kind); }

  async function renderVideo() {
    var l = editing, status = $('[data-video-status]'), preview = $('[data-video-preview]');
    $('[data-video-bar]').hidden = !upload;
    $('[data-video-cancel]').hidden = !upload;
    $('[data-video-remove]').hidden = !!upload || !l.video_path;
    $('[data-video-file]').disabled = !!upload;
    $('.adm-file').classList.toggle('is-disabled', !!upload);
    $('[data-video-pick]').textContent = l.video_path ? T.videoReplace : T.videoPick;
    if (upload) return;
    status.textContent = !l.video_path ? T.videoNone
      : l.duration_seconds ? fmt(T.videoReady, { d: formatDuration(l.duration_seconds) }) : T.videoReadyNoDur;
    preview.hidden = !l.video_path;
    preview.removeAttribute('src');
    if (!l.video_path) return;
    var res = await sb.storage.from(BUCKET).createSignedUrl(l.video_path, 60 * 60);
    if (editing !== l || upload) return;
    if (res.error) { console.warn('[admin] preview', res.error); return; }
    preview.src = res.data.signedUrl;
  }

  // Length of a local video file in seconds (null if the browser can't read it).
  function readDuration(file) {
    return new Promise(function (resolve) {
      var v = document.createElement('video'), url = URL.createObjectURL(file), done = false;
      function finish(val) { if (done) return; done = true; URL.revokeObjectURL(url); resolve(val); }
      v.preload = 'metadata';
      v.onloadedmetadata = function () { finish(isFinite(v.duration) ? Math.round(v.duration) : null); };
      v.onerror = function () { finish(null); };
      setTimeout(function () { finish(null); }, 10000);
      v.src = url;
    });
  }

  // Standard Storage upload with XMLHttpRequest, because fetch (supabase-js) can't report upload progress.
  function uploadFile(path, file, token, onProgress) {
    var xhr = new XMLHttpRequest();
    var promise = new Promise(function (resolve, reject) {
      var url = cfg.SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/' + path.split('/').map(encodeURIComponent).join('/');
      xhr.open('POST', url);
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.setRequestHeader('apikey', cfg.SUPABASE_ANON_KEY);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.setRequestHeader('cache-control', 'max-age=3600');
      xhr.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject({ status: xhr.status, body: String(xhr.responseText || '') });
      };
      xhr.onerror = function () { reject(new TypeError('network')); };
      xhr.onabort = function () { reject({ aborted: true }); };
      xhr.send(file);
    });
    return { promise: promise, abort: function () { xhr.abort(); } };
  }

  function setProgress(p) {
    var pct = Math.round(p * 100), bar = $('[data-video-bar]');
    bar.setAttribute('aria-valuenow', String(pct));
    $('i', bar).style.width = pct + '%';
    $('[data-video-status]').textContent = pct >= 100 ? T.videoSaving : fmt(T.videoUploading, { p: pct });
  }

  $('[data-video-file]').addEventListener('change', async function () {
    var input = this, file = input.files && input.files[0], l = editing;
    input.value = ''; // picking the same file again should fire change again
    if (!file || !l || upload) return;
    videoSay('');
    if (VIDEO_TYPES.indexOf(file.type) < 0) { videoSay(T.videoType, 'error'); return; }
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
      videoSay(fmt(T.videoTooBig, { s: Math.ceil(file.size / 1024 / 1024), m: MAX_VIDEO_MB }), 'error');
      return;
    }

    var ext = file.type === 'video/webm' ? 'webm' : 'mp4';
    var path = l.module_id + '/' + l.id + '-' + Date.now() + '.' + ext;
    var old = l.video_path, cancelled = false;
    upload = { abort: function () { cancelled = true; } }; // until the request has started
    setProgress(0);
    renderVideo();
    try {
      var duration = readDuration(file);
      var session = (await sb.auth.getSession()).data.session;
      if (cancelled) throw { aborted: true };
      if (!session) throw new Error('no session');
      var job = uploadFile(path, file, session.access_token, setProgress);
      upload = job;
      await job.promise;
      var row = { video_path: path, duration_seconds: await duration };
      check(await sb.from('lessons').update(row).eq('id', l.id));
      Object.assign(l, row);
      if (old) removeVideos([old]);
      upload = null;
      videoSay(T.videoUploaded, 'ok');
      renderContent();
    } catch (err) {
      upload = null;
      if (err && err.aborted) { videoSay(T.videoCancelled, 'info'); }
      else {
        console.warn('[admin] upload', err);
        var tooBig = err && (err.status === 413 || /maximum allowed size|too large/i.test(err.body || ''));
        videoSay(tooBig ? T.videoServerTooBig : err instanceof TypeError ? A.mapError(err) : T.videoError, 'error');
        // the file may have arrived even though attaching it failed: clean it up unless the lesson uses it
        if (l.video_path !== path) removeVideos([path]);
      }
    } finally {
      if (editing === l) renderVideo();
    }
  });

  $('[data-video-cancel]').addEventListener('click', function () { if (upload) upload.abort(); });

  $('[data-video-remove]').addEventListener('click', async function () {
    var l = editing, btn = this;
    if (!l || !l.video_path || btn.disabled || !window.confirm(T.confirmRemoveVideo)) return;
    A.setBusy(btn, true);
    videoSay('');
    try {
      var old = l.video_path;
      check(await sb.from('lessons').update({ video_path: null, duration_seconds: null }).eq('id', l.id));
      l.video_path = null;
      l.duration_seconds = null;
      removeVideos([old]);
      videoSay(T.videoRemoved, 'ok');
      renderContent();
    } catch (err) {
      console.warn('[admin] remove video', err);
      videoSay(T.saveError, 'error');
    } finally {
      A.setBusy(btn, false);
      if (editing === l) { renderVideo(); $('[data-video-file]').focus(); }
    }
  });

  // ---------- quiz editor (saved together with the lesson) ----------
  function renderQuizEditor(focusSel) {
    var list = $('[data-quiz-editor]');
    list.textContent = '';
    if (!questions.length) list.appendChild(el('li', { class: 'adm-empty', text: T.noQuestions }));
    questions.forEach(function (q, qi) {
      var pid = 'qz-' + q.id;
      var opts = el('ol', { class: 'qz-opts' });
      q.options.forEach(function (opt, oi) {
        var oid = pid + '-o' + oi, label = fmt(T.optionN, { n: oi + 1 });
        opts.appendChild(el('li', { class: 'qz-opt field' }, [
          el('input', { type: 'radio', name: pid + '-correct', value: String(oi), checked: q.correct === oi, 'aria-label': fmt(T.correctLabel, { n: oi + 1 }), title: fmt(T.correctLabel, { n: oi + 1 }), 'data-q': qi, 'data-correct': oi }),
          el('input', { id: oid, type: 'text', maxlength: '200', value: opt, placeholder: label, 'aria-label': label, 'data-q': qi, 'data-opt': oi }),
          iconBtn('x', fmt(T.removeOption, { n: oi + 1 }), { 'data-q': qi, 'data-remove-opt': oi, disabled: q.options.length <= 2 }),
        ]));
      });
      list.appendChild(el('li', { class: 'qz' }, [
        el('div', { class: 'field' }, [
          el('label', { for: pid, text: fmt(T.questionN, { n: qi + 1 }) }),
          el('input', { id: pid, type: 'text', maxlength: '500', value: q.prompt, 'data-q': qi, 'data-prompt': '' }),
        ]),
        opts,
        el('div', { class: 'adm-btns' }, [
          el('button', { class: 'btn ghost sm', type: 'button', 'data-q': qi, 'data-add-opt': '', disabled: q.options.length >= 6, text: T.addOption }),
          el('span', { class: 'adm-grow' }),
          iconBtn('up', T.up + ': ' + fmt(T.questionN, { n: qi + 1 }), { 'data-q': qi, 'data-move-q': '-1', disabled: qi === 0 }),
          iconBtn('down', T.down + ': ' + fmt(T.questionN, { n: qi + 1 }), { 'data-q': qi, 'data-move-q': '1', disabled: qi === questions.length - 1 }),
          el('button', { class: 'btn ghost sm is-danger', type: 'button', 'data-q': qi, 'data-remove-q': '', text: T.removeQuestion }),
        ]),
      ]));
    });
    if (focusSel) focusIn($(focusSel, list));
  }

  var quizBox = $('[data-quiz-editor]');
  quizBox.addEventListener('input', function (e) {
    var t = e.target, q = questions[Number(t.getAttribute('data-q'))];
    if (!q) return;
    if (t.hasAttribute('data-prompt')) q.prompt = t.value;
    else if (t.hasAttribute('data-opt')) q.options[Number(t.getAttribute('data-opt'))] = t.value;
    if (t.getAttribute('aria-invalid')) A.fieldError(t, '');
  });
  quizBox.addEventListener('change', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-correct')) questions[Number(t.getAttribute('data-q'))].correct = Number(t.getAttribute('data-correct'));
  });
  quizBox.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.disabled) return;
    var qi = Number(b.getAttribute('data-q')), q = questions[qi];
    if (b.hasAttribute('data-add-opt')) {
      q.options.push('');
      renderQuizEditor('[data-q="' + qi + '"][data-opt="' + (q.options.length - 1) + '"]');
    } else if (b.hasAttribute('data-remove-opt')) {
      var oi = Number(b.getAttribute('data-remove-opt'));
      q.options.splice(oi, 1);
      if (q.correct === oi) q.correct = 0; else if (q.correct > oi) q.correct--;
      renderQuizEditor('[data-q="' + qi + '"][data-opt="' + Math.min(oi, q.options.length - 1) + '"]');
    } else if (b.hasAttribute('data-move-q')) {
      var to = qi + Number(b.getAttribute('data-move-q'));
      questions.splice(to, 0, questions.splice(qi, 1)[0]);
      renderQuizEditor('[data-q="' + to + '"][data-move-q="' + b.getAttribute('data-move-q') + '"]');
    } else if (b.hasAttribute('data-remove-q')) {
      questions.splice(qi, 1);
      renderQuizEditor(questions.length ? '[data-q="' + Math.min(qi, questions.length - 1) + '"][data-prompt]' : null);
      if (!questions.length) $('[data-add-question]').focus();
    }
  });
  $('[data-add-question]').addEventListener('click', function () {
    questions.push({ id: uuid(), prompt: '', options: ['', ''], correct: 0 });
    renderQuizEditor('[data-q="' + (questions.length - 1) + '"][data-prompt]');
  });

  function validateQuiz() {
    var rules = [];
    questions.forEach(function (q, qi) {
      var prompt = $('[data-q="' + qi + '"][data-prompt]', quizBox);
      rules.push([prompt, function () { return q.prompt.trim() ? '' : T.quizPromptMissing; }]);
      q.options.forEach(function (o, oi) {
        var input = $('[data-q="' + qi + '"][data-opt="' + oi + '"]', quizBox);
        rules.push([input, function () { return o.trim() ? '' : T.quizOptionMissing; }]);
      });
    });
    return A.check(rules);
  }

  // ======================================================================================================
  // Foydalanuvchilar
  // ======================================================================================================
  function usersSay(text, kind) { A.say($('[data-users-msg]'), text, kind); }

  async function loadUsers() {
    usersSay('');
    $('[data-users-count]').textContent = A.T.busy;
    try {
      users = check(await sb.rpc('admin_list_users')) || [];
      renderUsers();
    } catch (err) {
      console.warn('[admin] users', err);
      $('[data-users-count]').textContent = '';
      usersSay(A.mapError(err), 'error');
    }
  }

  // Lessons a learner can open right now (published lesson in a published module): the denominator of "Darslar".
  function openLessonCount() {
    var pub = {};
    content.modules.forEach(function (m) { if (m.published) pub[m.id] = 1; });
    return content.lessons.filter(function (l) { return l.published && pub[l.module_id]; }).length;
  }

  function userName(u) { return u.full_name || u.email || T.dash; }

  function renderUsers() {
    if (!users) return;
    var q = $('#user-search').value.trim().toLowerCase();
    var list = !q ? users : users.filter(function (u) {
      return (u.full_name || '').toLowerCase().indexOf(q) >= 0 || (u.email || '').toLowerCase().indexOf(q) >= 0;
    });
    $('[data-users-count]').textContent = q ? fmt(T.usersFound, { n: list.length, t: users.length }) : fmt(T.usersCount, { n: users.length });
    var tbody = $('[data-users]'), total = openLessonCount();
    tbody.textContent = '';
    if (!list.length) tbody.appendChild(el('tr', null, [el('td', { colspan: '7', class: 'adm-empty', text: T.noUsers })]));
    list.forEach(function (u) {
      var name = userName(u);
      tbody.appendChild(el('tr', null, [
        el('th', { scope: 'row' }, [el('span', { class: 'adm-uname', text: u.full_name || T.dash }), u.is_admin ? badge(T.adminBadge, 'is-ok') : null]),
        el('td', null, [el('span', { class: 'adm-email', text: u.email || T.dash }), u.email_confirmed ? null : badge(T.unconfirmed, 'is-draft')]),
        el('td', { text: u.level ? A.T.levels[u.level] || u.level : T.dash }),
        el('td', { text: formatDate(u.created_at) }),
        el('td', { text: u.last_sign_in_at ? formatDate(u.last_sign_in_at, true) : T.never }),
        el('td', { text: fmt(T.lessonsDone, { d: u.lessons_done, t: total }) }),
        el('td', { class: 'adm-td-acts' }, [
          el('button', { class: 'btn ghost sm', type: 'button', 'data-set-pw': u.id, 'aria-label': fmt(T.setPasswordFor, { n: name }), text: T.setPassword }),
          u.email_confirmed ? null : el('button', { class: 'btn sm', type: 'button', 'data-confirm-email': u.id, 'aria-label': fmt(T.confirmEmailFor, { n: name }), text: T.confirmEmail }),
        ]),
      ]));
    });
  }

  function userById(id) { return users.filter(function (u) { return u.id === id; })[0]; }

  // Calls the admin-users Edge Function and turns its failures into one of our messages.
  async function adminUsers(body) {
    var res;
    try {
      res = await sb.functions.invoke('admin-users', { body: body });
    } catch (err) {
      return { error: T.fnUnavailable, raw: err };
    }
    if (!res.error) return { data: res.data };
    var status = res.error.context && res.error.context.status, code = '';
    try { code = (await res.error.context.json()).error || ''; } catch (e) { /* not JSON */ }
    console.warn('[admin] admin-users', res.error, status, code);
    if (code === 'weak_password') return { error: A.T.weakPassword, field: true };
    if (status === 401 || status === 403) return { error: T.forbidden };
    if (res.error.name === 'FunctionsFetchError' || res.error.name === 'FunctionsRelayError' || status === 404) return { error: T.fnUnavailable };
    return { error: A.mapError({ code: code, status: status, message: code }) };
  }

  var pwDialog = $('#password-dialog'), pwUser = null, pwOpener = null;

  function usersClicks(e) {
    var b = e.target.closest('button');
    if (!b || b.disabled) return;
    var id;
    if ((id = b.getAttribute('data-set-pw'))) {
      pwUser = userById(id);
      pwOpener = b;
      $('[data-pw-user]').textContent = fmt(T.pwUser, { n: pwUser.full_name || T.dash, e: pwUser.email || T.dash });
      $('#new-pw').value = '';
      openDialog(pwDialog);
    } else if ((id = b.getAttribute('data-confirm-email'))) {
      confirmEmail(userById(id), b);
    }
  }

  async function confirmEmail(u, btn) {
    A.setBusy(btn, true);
    usersSay('');
    var r = await adminUsers({ action: 'confirm_email', user_id: u.id });
    A.setBusy(btn, false);
    if (r.error) { usersSay(r.error, 'error'); return; }
    u.email_confirmed = true;
    renderUsers();
    usersSay(fmt(T.emailConfirmed, { n: userName(u) }), 'ok');
    var pw = $('[data-set-pw="' + u.id + '"]');
    if (pw) pw.focus();
  }

  // 12 characters without look-alikes (0/O, 1/l/I), easy to read out to a child or a parent.
  $('[data-gen-pw]').addEventListener('click', function () {
    var abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '';
    crypto.getRandomValues(new Uint32Array(12)).forEach(function (n) { out += abc.charAt(n % abc.length); });
    var input = $('#new-pw');
    input.value = out;
    A.fieldError(input, '');
    input.focus();
    input.select();
  });

  $('[data-password-form]').addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = $('[type=submit]', this), input = $('#new-pw'), msg = $('[data-password-msg]'), u = pwUser;
    if (!u || btn.disabled) return;
    A.say(msg, '');
    if (!A.check([[input, function () { return A.vNewPw(input); }]])) return;
    A.setBusy(btn, true);
    var r = await adminUsers({ action: 'set_password', user_id: u.id, password: input.value });
    A.setBusy(btn, false);
    if (r.error) {
      if (r.field) { A.fieldError(input, r.error); input.focus(); } else A.say(msg, r.error, 'error');
      return;
    }
    input.value = '';
    pwDialog.close();
    usersSay(fmt(T.passwordSet, { n: userName(u) }), 'ok');
  });
  pwDialog.addEventListener('close', function () {
    $('#new-pw').value = '';
    if (pwOpener && document.contains(pwOpener)) pwOpener.focus();
  });

  // ======================================================================================================
  // So'rovnoma
  // ======================================================================================================
  function surveySay(text, kind) { A.say($('[data-survey-msg]'), text, kind); }

  async function loadSurvey() {
    surveySay('');
    $('[data-survey-count]').textContent = A.T.busy;
    try {
      survey = check(await sb.rpc('admin_survey_responses')) || [];
      renderSurvey();
    } catch (err) {
      console.warn('[admin] survey', err);
      $('[data-survey-count]').textContent = '';
      surveySay(A.mapError(err), 'error');
    }
  }

  // [{ key, label }] in questionnaire order for a role (js/survey-questions.js), including the "extra" text fields.
  function surveyColumns(role) {
    var cols = [], S = window.SURVEY || {};
    ((S[role] && S[role].questions) || []).forEach(function (q) {
      cols.push({ key: q.id, label: q.text });
      if (q.extra) cols.push({ key: q.extra.key, label: q.extra.label });
    });
    return cols;
  }
  // The questionnaire's columns plus any answer keys it no longer has (older questions), so nothing is hidden.
  function columnsFor(role, rows) {
    var cols = surveyColumns(role), known = {};
    cols.forEach(function (c) { known[c.key] = 1; });
    rows.forEach(function (r) {
      Object.keys(r.answers || {}).forEach(function (k) { if (!known[k]) { known[k] = 1; cols.push({ key: k, label: k }); } });
    });
    return cols;
  }
  function answerText(v) {
    if (Array.isArray(v)) return v.join('; ');
    return v === null || v === undefined || v === '' ? T.dash : String(v);
  }
  function filteredSurvey() {
    var role = $('#survey-role').value;
    return (survey || []).filter(function (r) { return !role || r.role === role; });
  }

  function renderSurvey() {
    if (!survey) return;
    var rows = filteredSurvey(), list = $('[data-survey]'), colsByRole = {};
    ['student', 'teacher'].forEach(function (role) {
      colsByRole[role] = columnsFor(role, rows.filter(function (r) { return r.role === role; }));
    });
    $('[data-survey-count]').textContent = fmt(T.surveyCount, { n: rows.length });
    $('[data-csv]').disabled = !rows.length;
    list.textContent = '';
    if (!rows.length) list.appendChild(el('li', { class: 'empty-note', text: T.noSurvey }));
    rows.forEach(function (r) {
      var meta = [T.roles[r.role] || r.role, r.age_range, r.region].filter(Boolean).join(' · ');
      var dl = el('dl', { class: 'adm-answers' });
      colsByRole[r.role] = colsByRole[r.role] || columnsFor(r.role, [r]);
      colsByRole[r.role].forEach(function (c) {
        if (!(c.key in (r.answers || {}))) return;
        dl.appendChild(el('dt', { text: c.label }));
        dl.appendChild(el('dd', { text: answerText(r.answers[c.key]) }));
      });
      list.appendChild(el('li', null, [
        el('details', { class: 'adm-resp' }, [
          el('summary', null, [
            el('span', { class: 'adm-resp-name', text: r.name }),
            el('span', { class: 'adm-resp-meta', text: meta }),
            el('a', { class: 'adm-resp-phone', href: 'tel:' + r.phone, text: r.phone }),
            el('span', { class: 'adm-resp-date', text: formatDate(r.created_at, true) }),
          ]),
          dl,
        ]),
      ]));
    });
  }

  // CSV for Excel: UTF-8 with BOM and ";" separators (what Excel expects with Uzbek / Russian regional settings).
  function downloadCsv() {
    var rows = filteredSurvey();
    if (!rows.length) return;
    var roles = ['student', 'teacher'].filter(function (role) { return rows.some(function (r) { return r.role === role; }); });
    var cols = [];
    roles.forEach(function (role) {
      columnsFor(role, rows.filter(function (r) { return r.role === role; })).forEach(function (c) {
        cols.push({ role: role, key: c.key, label: roles.length > 1 ? '[' + T.roles[role] + '] ' + c.label : c.label });
      });
    });
    function cell(v) {
      var s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v);
      // keep spreadsheet apps from running answers as formulas (plain numbers like +998901234567 are safe)
      if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d[\d ]*$/.test(s)) s = "'" + s;
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = [T.csvCols.concat(cols.map(function (c) { return c.label; })).map(cell).join(';')];
    rows.forEach(function (r) {
      var base = [formatDate(r.created_at, true), T.roles[r.role] || r.role, r.name, r.phone, r.age_range, r.region];
      var answers = cols.map(function (c) { return c.role === r.role && r.answers ? r.answers[c.key] : ''; });
      lines.push(base.concat(answers).map(cell).join(';'));
    });
    var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var d = new Date(), a = el('a', { href: URL.createObjectURL(blob), download: fmt(T.csvName, { d: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) }) });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ======================================================================================================
  // Tabs (#darslar / #foydalanuvchilar / #sorovnoma) and start
  // ======================================================================================================
  var HASH = { content: 'darslar', users: 'foydalanuvchilar', survey: 'sorovnoma' };
  var loaded = {};

  function selectTab(name, focus) {
    $$('[data-tab]').forEach(function (t) {
      var on = t.getAttribute('data-tab') === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    $$('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== name; });
    history.replaceState(null, '', '#' + HASH[name]);
    if (!loaded[name]) {
      loaded[name] = true;
      if (name === 'users') loadUsers();
      if (name === 'survey') loadSurvey();
    }
  }

  function initTabs() {
    var tabs = $$('[data-tab]');
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { selectTab(t.getAttribute('data-tab')); });
      t.addEventListener('keydown', function (e) {
        var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
        if (j === null) return;
        e.preventDefault();
        selectTab(tabs[(j + tabs.length) % tabs.length].getAttribute('data-tab'), true);
      });
    });
    var fromHash = Object.keys(HASH).filter(function (k) { return '#' + HASH[k] === location.hash; })[0];
    selectTab(fromHash || 'content');
  }

  var started = false;
  async function start() {
    show('loading');
    try {
      var admin = check(await sb.rpc('is_admin'));
      if (admin !== true) { show('denied'); return; }
      await loadContent();
    } catch (err) {
      console.warn('[admin]', err);
      show('error');
      return;
    }
    renderContent();
    show('ready');
    if (started) return;
    started = true;
    $('[data-panel="content"]').addEventListener('click', contentClicks);
    $('[data-users]').addEventListener('click', usersClicks);
    $('#user-search').addEventListener('input', renderUsers);
    $('#survey-role').addEventListener('change', renderSurvey);
    $('[data-csv]').addEventListener('click', downloadCsv);
    $$('[data-reload]').forEach(function (b) {
      b.addEventListener('click', function () { b.getAttribute('data-reload') === 'users' ? loadUsers() : loadSurvey(); });
    });
    initTabs();
  }

  if (!sb || !A) { location.replace('login.html'); return; }
  $('[data-retry]').addEventListener('click', start);

  sb.auth.getSession().then(function (res) {
    var session = res && res.data ? res.data.session : null;
    if (!session) return; // js/app.js redirects to login.html
    start();
  }, function (err) {
    console.warn('[admin]', err);
    show('error');
  });
})();
