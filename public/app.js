// Progressive enhancement only: every workflow action works without JS.
// JS adds the AI suggestion cards and small conveniences.
(function () {
  'use strict';
  var T = window.KS.t;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function verdictLabel(v) {
    return { proceed: T.action_proceed, return: T.action_return, reject: T.action_reject }[v] || v;
  }

  function render(box, data, kind) {
    box.innerHTML = '';
    box.classList.toggle('is-rules', data.source === 'rules');
    var head = el('div', 'ai-head');
    head.appendChild(el('span', 'ai-badge', data.source === 'rules' ? T.ai_rules : '✦ ' + T.ai_suggestion));
    if (data.verdict) head.appendChild(el('span', 'tag verdict-' + data.verdict, T.ai_suggested_action + ': ' + verdictLabel(data.verdict)));
    var refresh = el('button', 'linkbtn', T.ai_refresh);
    refresh.type = 'button';
    refresh.onclick = function () { load(box, kind, true); };
    head.appendChild(refresh);
    box.appendChild(head);

    box.appendChild(el('p', 'ai-summary', data.summary));
    if (data.concerns && data.concerns.length) {
      box.appendChild(el('strong', 'small', T.ai_concerns));
      var ul = el('ul', 'ai-concerns');
      data.concerns.forEach(function (c) { ul.appendChild(el('li', null, c)); });
      box.appendChild(ul);
    }

    var form = box.dataset.fill && document.querySelector(box.dataset.fill);
    if (form && (data.note || data.citizen_message)) {
      if (data.citizen_message) {
        box.appendChild(el('strong', 'small', T.citizen_message));
        box.appendChild(el('p', 'sms', data.citizen_message));
      }
      var use = el('button', 'btn ai-use', T.ai_use_draft);
      use.type = 'button';
      use.onclick = function () {
        if (data.note) form.elements.note.value = data.note;
        if (data.citizen_message) form.elements.message.value = data.citizen_message;
        form.elements.ai_used.value = '1';
        updateCounter(form);
        form.elements.note.focus();
      };
      box.appendChild(use);
    }
    box.appendChild(el('p', 'ai-disclaimer', T.ai_disclaimer));
  }

  function load(box, kind, refresh) {
    kind = kind || box.dataset.aiKind;
    box.dataset.aiKind = kind;
    box.innerHTML = '';
    box.appendChild(el('p', 'ai-loading', T.ai_loading));
    box.setAttribute('aria-busy', 'true');
    var url = '/api/app/' + box.dataset.app + '/ai?kind=' + encodeURIComponent(kind) + (refresh ? '&refresh=1' : '');
    fetch(url, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { if (box.dataset.aiKind === kind) render(box, data, kind); })
      .catch(function () { box.innerHTML = ''; box.appendChild(el('p', 'alert warn', T.ai_error)); })
      .finally(function () { box.removeAttribute('aria-busy'); });
  }

  function updateCounter(form) {
    var c = form.querySelector('[data-counter]');
    if (c) c.textContent = form.elements.message.value.length + ' / 400';
  }

  // Lazy-load AI for boxes when they become visible (saves calls for collapsed panels).
  var boxes = document.querySelectorAll('.ai[data-ai-kind]');
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting && !en.target.dataset.loaded) { en.target.dataset.loaded = '1'; load(en.target); }
    });
  }) : null;
  boxes.forEach(function (b) {
    b.appendChild(el('p', 'ai-loading', T.ai_loading));
    io ? io.observe(b) : load(b);
  });

  // Decision forms: switching approve/reject/return changes the AI draft and resets ai_used.
  document.querySelectorAll('[data-decision-form]').forEach(function (form) {
    var box = form.querySelector('.ai');
    form.addEventListener('change', function (e) {
      if (e.target.name === 'action') {
        form.elements.ai_used.value = '0';
        box.dataset.loaded = '1';
        load(box, 'decide:' + e.target.value);
      }
    });
    form.elements.message.addEventListener('input', function () { updateCounter(form); });
    form.addEventListener('submit', function (e) {
      var action = form.elements.action.value;
      if ((action === 'reject' || action === 'return') && !form.elements.note.value.trim()) {
        e.preventDefault();
        form.elements.note.setCustomValidity(' ');
        form.elements.note.reportValidity();
        form.elements.note.focus();
      }
    });
    form.elements.note.addEventListener('input', function () { form.elements.note.setCustomValidity(''); });
  });

  // Recalculate as soon as the last-paid year changes.
  document.querySelectorAll('[data-autosubmit] select').forEach(function (s) {
    s.addEventListener('change', function () { s.form.submit(); });
  });
})();
