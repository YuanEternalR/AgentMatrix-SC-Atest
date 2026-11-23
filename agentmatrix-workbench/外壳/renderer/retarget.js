/**
 * 领域改造补丁：把模板里与"供应链"无关的入口收起来。
 *
 * 为什么用运行时补丁而不是删代码：
 * 模板的 `renderer.js` / `webai-bridge.js`（合计约 200KB）里大量引用这些按钮的 id，
 * 直接删 DOM 或删脚本会触发它们内部的空引用。这里只在渲染完成后把不相关按钮隐藏，
 * 保留全部实现，想恢复删掉本文件即可。
 */
(function () {
  'use strict';

  // 要收起来的入口：模板作者的个人站 / 捐赠 / 市场 / 免费网页版 AI（豆包·通义·智谱·Kimi）
  var HIDE_PATTERNS = [
    /豆包/,
    /通义/,
    /千问/,
    /智谱/,
    /清言/,
    /Kimi/i,
    /个人站/,
    /市场/,
    /捐赠/,
    /打赏/,
  ];

  function shouldHide(el) {
    var text = (el.textContent || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '');
    return HIDE_PATTERNS.some(function (re) {
      return re.test(text);
    });
  }

  function sweep() {
    var nodes = document.querySelectorAll('.tb-btn, .titlebar-controls button, .topbar-right button, button');
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      if (el.dataset.amKeep === '1') continue;
      // 别误伤我们自己的按钮：只处理标题栏区域的
      if (!el.closest('#titlebar') && !el.closest('.titlebar-controls')) continue;
      if (shouldHide(el)) {
        el.style.display = 'none';
        el.dataset.amHidden = '1';
      }
    }
  }

  function boot() {
    sweep();
    // 这些按钮是脚本后注入的：再扫几轮，避免时序问题
    var rounds = 0;
    var timer = setInterval(function () {
      sweep();
      rounds += 1;
      if (rounds >= 12) clearInterval(timer);
    }, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
