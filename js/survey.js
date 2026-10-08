// Surveys (survey.html): role picker, then a multi-step student or teacher form built from js/survey-questions.js.
// Public, no login. Answers are inserted into public.survey_responses (supabase/survey-schema.sql), which is
// insert-only for the site: never add .select() to the insert, reading the row back is not allowed.
(function () {
  'use strict';

  var S = window.SURVEY;
  var sb = window.sb || null;
  var root = document.getElementById('survey');
  if (!S || !root) return;

  var T = {
    required: 'Iltimos, javobni tanlang.',
    requiredText: "Iltimos, bu maydonni to'ldiring.",
    name: 'Ismingizni kiriting (kamida 2 ta harf).',
    phone: "Telefon raqamini to'liq kiriting, masalan: +998 90 123 45 67.",
    stepOf: function (i, n) { return i + '-qadam / ' + n; },
    send: 'Yuborish',
    retry: 'Qayta yuborish',
    network: "Javobni yuborib bo'lmadi. Internet aloqasini tekshirib, qayta urinib ko'ring.",
    server: "Javobni saqlashda xatolik yuz berdi. Bir ozdan keyin qayta urinib ko'ring.",
    notConfigured: "So'rovnoma hozircha ishlamayapti (server sozlanmagan). Keyinroq urinib ko'ring.",
  };

  // ---------- helpers ----------
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  // Small DOM builder. Text always goes in as textContent, never as HTML.
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v == null) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'className') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }

  // Uzbek numbers: 9 local digits, or 12 starting with 998. Returns "+998XXXXXXXXX" or null.
  function normPhone(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length === 9) d = '998' + d;
    return /^998\d{9}$/.test(d) ? '+' + d : null;
  }

  // ---------- building the forms ----------
  // Each "item" is one validated block: a question fieldset or a contact field.
  function choiceItem(role, q, num) {
    var name = role + '-' + q.id;
    var err = h('p', { className: 'field-error', id: name + '-err', hidden: true });
    var opts = h('div', { className: 'sv-opts' + (q.scale ? ' is-scale' : '') + (q.grid ? ' is-grid' : '') },
      q.options.map(function (o) {
        return h('label', { className: 'sv-opt' }, [
          h('input', { type: q.type === 'multi' ? 'checkbox' : 'radio', name: name, value: o }),
          h('span', { text: o }),
        ]);
      }));
    var legend = h('legend', null, [
      num ? h('span', { className: 'sv-num', 'aria-hidden': 'true', text: String(num) }) : null,
      h('span', null, [q.text, q.hint ? h('span', { className: 'sv-hint', text: q.hint }) : null]),
    ]);
    var fs = h('fieldset', { className: 'sv-q', 'aria-describedby': name + '-err' }, [legend, opts]);

    var extra = null;
    if (q.extra) {
      var xid = name + '-x';
      extra = h('div', { className: 'sv-extra', hidden: !!q.extra.when }, [
        h('label', { for: xid, text: q.extra.label + (q.extra.required ? '' : ' (ixtiyoriy)') }),
        h('textarea', { id: xid, name: xid, rows: '3', maxlength: '500', 'aria-describedby': xid + '-err' }),
        h('p', { className: 'field-error', id: xid + '-err', hidden: true }),
      ]);
      fs.appendChild(extra);
      if (q.extra.when) {
        // Conditional field: only shown (and required) while its option is selected
        opts.addEventListener('change', function () {
          extra.hidden = value() !== q.extra.when;
          if (extra.hidden) setErr($('textarea', extra), null);
        });
      }
    }
    fs.appendChild(err);

    function value() {
      var checked = $$('input:checked', opts).map(function (i) { return i.value; });
      return q.type === 'multi' ? checked : (checked[0] || null);
    }
    var item = {
      el: fs,
      first: function () { return $('input', opts); },
      validate: function (show) {
        var v = value(), ok = q.type === 'multi' ? v.length > 0 : !!v;
        if (show) { setErr(fs, ok ? null : T.required, err); }
        if (ok && extra && !extra.hidden && q.extra.required) {
          var ta = $('textarea', extra), okX = !!ta.value.trim();
          if (show) setErr(ta, okX ? null : T.requiredText);
          if (!okX) { item.firstBad = ta; return false; }
        }
        item.firstBad = ok ? null : item.first();
        return ok;
      },
      collect: function (out) {
        out[q.id] = value();
        if (extra && !extra.hidden) {
          var t = $('textarea', extra).value.trim();
          if (t) out[q.extra.key] = t;
        }
      },
    };
    opts.addEventListener('change', function () { if (fs.classList.contains('is-invalid')) item.validate(true); });
    return item;
  }

  function textItem(role, f) {
    var id = role + '-' + f.key;
    var input = h('input', { id: id, name: f.key, type: f.type, autocomplete: f.autocomplete, inputmode: f.inputmode,
      placeholder: f.placeholder, maxlength: f.max, required: true, 'aria-describedby': id + '-err' });
    var err = h('p', { className: 'field-error', id: id + '-err', hidden: true });
    var wrap = h('div', { className: 'field' }, [h('label', { for: id, text: f.label }), input, err]);
    var item = {
      el: wrap,
      validate: function (show) {
        var ok = f.check(input.value);
        if (show) setErr(input, ok ? null : f.error, err);
        item.firstBad = ok ? null : input;
        return ok;
      },
      collect: function (out) { out[f.key] = f.clean(input.value); },
    };
    input.addEventListener('blur', function () { if (input.value) item.validate(true); });
    input.addEventListener('input', function () { if (input.getAttribute('aria-invalid') === 'true') item.validate(true); });
    return item;
  }

  function setErr(target, msg, errEl) {
    errEl = errEl || document.getElementById(target.getAttribute('aria-describedby'));
    if (target.tagName === 'FIELDSET') target.classList.toggle('is-invalid', !!msg);
    else if (msg) target.setAttribute('aria-invalid', 'true');
    else target.removeAttribute('aria-invalid');
    if (errEl) { errEl.textContent = msg || ''; errEl.hidden = !msg; }
  }

  var CONTACT = [
    { key: 'name', label: 'Ismingiz', type: 'text', autocomplete: 'name', max: '80', error: T.name,
      check: function (v) { return v.trim().length >= 2; }, clean: function (v) { return v.trim().replace(/\s+/g, ' '); } },
    { key: 'phone', label: 'Telefon raqamingiz', type: 'tel', autocomplete: 'tel', inputmode: 'tel', max: '20',
      placeholder: '+998 90 123 45 67', error: T.phone, check: function (v) { return !!normPhone(v); }, clean: normPhone },
  ];

  function buildForm(role) {
    var cfg = S[role], qs = cfg.questions;
    var steps = [];
    if (role === 'student') {
      steps.push({ title: "Siz haqingizda", items: [
        choiceItem(role, { id: 'age_range', type: 'single', text: 'Sizning yoshingiz', options: S.AGE_RANGES, grid: true }),
        choiceItem(role, { id: 'region', type: 'single', text: 'Yashash manzilingiz', options: S.REGIONS, grid: true }),
      ] });
    } else {
      steps.push({ title: "Siz haqingizda", items: [
        choiceItem(role, { id: 'age_range', type: 'single', text: 'Sizning yoshingiz', options: S.TEACHER_AGE_RANGES, grid: true }),
      ] });
    }
    steps.push({ title: 'Savollar: 1–5', items: qs.slice(0, 5).map(function (q, i) { return choiceItem(role, q, i + 1); }) });
    steps.push({ title: 'Savollar: 6–10', items: qs.slice(5).map(function (q, i) { return choiceItem(role, q, i + 6); }) });
    steps.push({ title: "Bog'lanish uchun", note: "Natijalar bo'yicha siz bilan bog'lanishimiz mumkin. Ma'lumotlaringiz faqat shu so'rovnoma uchun ishlatiladi.",
      items: CONTACT.map(function (f) { return textItem(role, f); }) });

    var bar = h('i');
    var count = h('span');
    var stepName = h('span');
    var msg = h('p', { className: 'form-msg is-error', 'aria-live': 'polite', hidden: true });
    var back = h('button', { className: 'btn ghost', type: 'button', text: 'Orqaga' });
    var next = h('button', { className: 'btn blue', type: 'button', text: 'Keyingisi' });
    var submit = h('button', { className: 'btn blue', type: 'submit', text: T.send, disabled: true });

    var stepEls = steps.map(function (st, i) {
      var head = h('h2', { className: 'sv-step-title', tabindex: '-1', text: st.title });
      return h('div', { className: 'sv-step', hidden: i > 0 }, [head, st.note ? h('p', { className: 'sv-note', text: st.note }) : null]
        .concat(st.items.map(function (it) { return it.el; })));
    });

    var form = h('form', { className: 'sv-form', novalidate: true, hidden: true, 'data-role': role }, [
      h('button', { className: 'sv-back', type: 'button', 'data-switch': true, text: '← Boshqa rolni tanlash' }),
      h('p', { className: 'sv-form-title', text: cfg.title }),
      h('div', { className: 'sv-progress' }, [
        h('div', { className: 'sv-progress-row' }, [stepName, count]),
        h('div', { className: 'sv-bar', role: 'progressbar', 'aria-label': "So'rovnoma bosqichi", 'aria-valuemin': '1', 'aria-valuemax': String(steps.length) }, [bar]),
      ]),
    ].concat(stepEls, [msg, h('div', { className: 'sv-nav' }, [back, next, submit])]));

    var cur = 0, all = steps.reduce(function (a, st) { return a.concat(st.items); }, []);

    function show(i, focus) {
      cur = i;
      stepEls.forEach(function (el, j) { el.hidden = j !== i; });
      var pb = $('.sv-bar', form);
      pb.setAttribute('aria-valuenow', String(i + 1));
      pb.setAttribute('aria-valuetext', T.stepOf(i + 1, steps.length));
      bar.style.width = ((i + 1) / steps.length * 100) + '%';
      count.textContent = T.stepOf(i + 1, steps.length);
      stepName.textContent = steps[i].title;
      back.hidden = i === 0;
      next.hidden = i === steps.length - 1;
      submit.hidden = i !== steps.length - 1;
      msg.hidden = true;
      if (focus) {
        $('.sv-step-title', stepEls[i]).focus({ preventScroll: true });
        root.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    }

    function checkStep(i) {
      var bad = null;
      steps[i].items.forEach(function (it) { if (!it.validate(true) && !bad) bad = it.firstBad; });
      if (bad) bad.focus();
      return !bad;
    }

    function refreshSubmit() { submit.disabled = !all.every(function (it) { return it.validate(false); }) || form.dataset.busy === '1'; }

    next.addEventListener('click', function () { if (checkStep(cur)) show(cur + 1, true); });
    back.addEventListener('click', function () { show(cur - 1, true); });
    form.addEventListener('input', refreshSubmit);
    form.addEventListener('change', refreshSubmit);
    // Enter in a text field moves on instead of submitting an unfinished form
    form.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && cur < steps.length - 1) { e.preventDefault(); next.click(); }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (form.dataset.busy === '1') return;
      for (var i = 0; i < steps.length; i++) { if (!checkStep(i)) { show(i, false); checkStep(i); return; } }
      if (!sb) { say(T.notConfigured); return; }

      var data = {};
      all.forEach(function (it) { it.collect(data); });
      var row = { role: role, name: data.name, phone: data.phone, age_range: data.age_range || null, region: data.region || null, answers: {} };
      qs.forEach(function (q) {
        row.answers[q.id] = data[q.id];
        if (q.extra && data[q.extra.key]) row.answers[q.extra.key] = data[q.extra.key];
      });

      form.dataset.busy = '1';
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
      submit.textContent = 'Yuborilmoqda…';
      msg.hidden = true;
      // No .select(): the table is insert-only for the site (supabase/survey-schema.sql)
      sb.from('survey_responses').insert(row).then(function (res) {
        if (res.error) throw res.error;
        done();
      }).catch(function (err) {
        console.warn('[survey]', err);
        var net = err instanceof TypeError || /fetch|network/i.test(String(err && err.message));
        say(net ? T.network : T.server);
        form.dataset.busy = '';
        submit.removeAttribute('aria-busy');
        submit.textContent = T.retry;
        refreshSubmit();
      });
    });

    function say(text) { msg.textContent = text; msg.hidden = false; }

    show(0, false);
    return { form: form, start: function () { show(cur, false); refreshSubmit(); } };
  }

  // ---------- page flow ----------
  var picker = $('#sv-pick', root);
  var success = $('#sv-done', root);
  var forms = { student: buildForm('student'), teacher: buildForm('teacher') };
  picker.after(forms.student.form, forms.teacher.form);

  function pick(role) {
    picker.hidden = true;
    Object.keys(forms).forEach(function (r) { forms[r].form.hidden = r !== role; });
    forms[role].start();
    $('.sv-step:not([hidden]) .sv-step-title', forms[role].form).focus({ preventScroll: true });
    root.scrollIntoView({ block: 'start' });
  }
  $$('[data-role-pick]', picker).forEach(function (b) {
    b.addEventListener('click', function () { pick(b.getAttribute('data-role-pick')); });
  });
  // Switching role keeps both forms' answers: the other form is only hidden
  $$('[data-switch]', root).forEach(function (b) {
    b.addEventListener('click', function () {
      Object.keys(forms).forEach(function (r) { forms[r].form.hidden = true; });
      picker.hidden = false;
      $('h1', picker).focus({ preventScroll: true });
      root.scrollIntoView({ block: 'start' });
    });
  });

  function done() {
    Object.keys(forms).forEach(function (r) { forms[r].form.remove(); });
    picker.hidden = true;
    success.hidden = false;
    $('h1', success).focus({ preventScroll: true });
    root.scrollIntoView({ block: 'start' });
  }

  $$('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
