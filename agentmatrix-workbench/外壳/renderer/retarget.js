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

  // 面板标题栏的按钮原本带 emoji（⛔ 取消内置 / 🔄 刷新 / 🌐 浏览器打开）：
  // 和这套框架的深色细线风格不搭，这里只去掉前缀图标，保留文字与原有事件。
  var EMOJI_PREFIX = /^[\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF\uFE0F\u200D\u{1F000}-\u{1FAFF}\s]+/u;

  function cleanPanelButtons() {
    var nodes = document.querySelectorAll('.panel-head button, .panel-head a');
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      if (el.dataset.amTextCleaned === '1') continue;
      var original = (el.textContent || '').trim();
      if (!original) continue;
      var stripped = original.replace(EMOJI_PREFIX, '').trim();
      if (stripped && stripped !== original) {
        el.textContent = stripped;
      }
      el.dataset.amTextCleaned = '1';
    }
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
    cleanPanelButtons();
  }

  function boot() {
    sweep();
    // 面板是切场景时才创建的：用 MutationObserver 持续收，别只跑几轮定时器
    if (window.MutationObserver) {
      var pending = null;
      var observer = new MutationObserver(function () {
        if (pending) return;
        pending = setTimeout(function () {
          pending = null;
          sweep();
        }, 120);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    // 兜底：有些按钮由 setInterval 注入，前几秒再扫几轮
    var rounds = 0;
    var timer = setInterval(function () {
      sweep();
      rounds += 1;
      if (rounds >= 20) clearInterval(timer);
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
