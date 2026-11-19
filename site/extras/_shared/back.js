/* databricksedu extras: a small "back" button that stays on top of any page. */
(function () {
  function add() {
    if (document.getElementById('dbe-back')) return;
    var a = document.createElement('a');
    a.id = 'dbe-back';
    a.href = '../../';
    a.textContent = '← databricksedu';
    a.title = 'Back to all modules';
    a.setAttribute('style', 'position:fixed;top:14px;left:14px;z-index:2147483647;padding:8px 14px;border-radius:999px;' +
      'background:rgba(27,49,57,.88);color:#fff;font:600 14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'text-decoration:none;box-shadow:0 6px 20px rgba(0,0,0,.25);backdrop-filter:blur(6px)');
    document.body.appendChild(a);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
  setTimeout(add, 1500);
})();
