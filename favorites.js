/* علاقه‌مندی‌ها - املاک راد
   لیست ملک‌های ذخیره‌شده روی همین مرورگر (localStorage) نگه‌داری می‌شود. */
(function () {
  var KEY = 'rr_favorites';
  var MAX_SAVED = 100;

  function read() {
    try {
      var a = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string' && x; }) : [];
    } catch (e) { return []; }
  }

  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_SAVED))); } catch (e) {}
  }

  function has(id) { return read().indexOf(String(id)) !== -1; }

  function toggle(id) {
    id = String(id);
    var list = read();
    var i = list.indexOf(id);
    if (i === -1) list.unshift(id); else list.splice(i, 1);
    write(list);
    refresh();
    return i === -1;
  }

  function remove(id) {
    id = String(id);
    write(read().filter(function (x) { return x !== id; }));
    refresh();
  }

  // نگه داشتن فقط شناسه‌هایی که هنوز وجود دارند (برای پاک‌کردن ملک‌های حذف‌شده)
  function keepOnly(validIds) {
    var set = {};
    validIds.forEach(function (x) { set[String(x)] = true; });
    var list = read();
    var cleaned = list.filter(function (x) { return set[x]; });
    if (cleaned.length !== list.length) { write(cleaned); refresh(); }
  }

  // HTML دکمه‌ی قلب. اگر label داده بشه، دکمه متن هم دارد (برای صفحه‌ی ملک).
  function heartButton(id, extraClass, withLabel) {
    id = String(id).replace(/[^0-9A-Za-z_-]/g, '');
    var label = withLabel
      ? '<span class="fav-label mr-2" data-fav-label="1">افزودن به علاقه‌مندی‌ها</span>'
      : '';
    return '<button type="button" class="fav-btn ' + (extraClass || '') + '" data-fav-id="' + id + '"' +
      ' aria-label="ذخیره در علاقه‌مندی‌ها"' +
      ' onclick="event.preventDefault();event.stopPropagation();RRFav.toggle(\'' + id + '\')">' +
      '<i class="far fa-heart"></i>' + label + '</button>';
  }

  function refresh() {
    var list = read();
    var buttons = document.querySelectorAll('[data-fav-id]');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var on = list.indexOf(btn.getAttribute('data-fav-id')) !== -1;
      var icon = btn.querySelector('i');
      if (icon) icon.className = (on ? 'fas' : 'far') + ' fa-heart';
      btn.classList.toggle('fav-on', on);
      var lbl = btn.querySelector('[data-fav-label]');
      if (lbl) lbl.textContent = on ? 'در علاقه‌مندی‌هاست' : 'افزودن به علاقه‌مندی‌ها';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var badge = document.getElementById('rrFavFloat');
    if (badge) {
      var count = list.length;
      badge.style.display = count > 0 ? 'flex' : 'none';
      var num = badge.querySelector('[data-fav-count]');
      if (num) num.textContent = count.toLocaleString('fa-IR');
    }
  }

  function injectStyle() {
    var css =
      '.fav-btn{display:inline-flex;align-items:center;justify-content:center;border:1px solid #3f3f46;cursor:pointer;' +
      'color:#d4af37;background:rgba(0,0,0,.65);backdrop-filter:blur(4px);transition:transform .2s,background .2s;}' +
      '.fav-btn:hover{transform:scale(1.1);background:rgba(0,0,0,.85);}' +
      '.fav-btn.fav-on{color:#ef4444;}' +
      '.fav-btn:not(.fav-label-btn){width:2.75rem;height:2.75rem;border-radius:9999px;font-size:1.1rem;}' +
      '.fav-btn.fav-wide{width:auto;height:auto;border-radius:1rem;font-size:1rem;}' +
      '#rrFavFloat{position:fixed;bottom:1.5rem;right:1.5rem;z-index:60;align-items:center;gap:.5rem;' +
      'background:#18181b;border:1px solid #3f3f46;color:#fafafa;padding:.75rem 1.1rem;border-radius:9999px;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.5);text-decoration:none;font-family:inherit;font-weight:600;display:none;}' +
      '#rrFavFloat:hover{border-color:#d4af37;}' +
      '#rrFavFloat i{color:#ef4444;}' +
      '#rrFavFloat [data-fav-count]{background:#d4af37;color:#111827;border-radius:9999px;min-width:1.5rem;' +
      'height:1.5rem;display:inline-flex;align-items:center;justify-content:center;font-size:.8rem;padding:0 .35rem;}';
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function addFloatingButton() {
    if (document.getElementById('rrFavFloat')) return;
    if (/^\/favorites(\.html)?\/?$/.test(location.pathname)) return; // خود صفحه‌ی علاقه‌مندی‌ها
    var a = document.createElement('a');
    a.id = 'rrFavFloat';
    a.href = '/favorites.html';
    a.innerHTML = '<i class="fas fa-heart"></i><span>علاقه‌مندی‌ها</span><span data-fav-count>0</span>';
    document.body.appendChild(a);
  }

  window.RRFav = {
    read: read, has: has, toggle: toggle, remove: remove,
    keepOnly: keepOnly, heartButton: heartButton, refresh: refresh
  };

  function init() {
    injectStyle();
    addFloatingButton();
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // همگام‌سازی بین تب‌ها
  window.addEventListener('storage', function (e) { if (e.key === KEY) refresh(); });
})();
