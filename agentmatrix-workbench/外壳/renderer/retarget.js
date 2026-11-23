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

  // 模板自带的「DSH 引擎」场景与「Harness 已连接/未就绪」状态，是它自家 AI 会话用的。
  // 我们的 AI 面板是原生助手，不需要这个场景；留着只会让用户看到一个永远"没就绪"的面板。
  function hideEngineBits() {
    // 引擎场景（DSH 主界面）现在**保留**：工作台会自己拉起引擎并抓到 token，
    // 这个场景就是真实的 DSH 会话界面，是整台工作台的"大脑"入口。
    // 只有引擎没起来时才把它藏起来，避免用户看到一个永远"未就绪"的页面。
    var engineReady = false;
    try { engineReady = !!(window.app && window.app.isHarnessReady && false); } catch (e) { /* ignore */ }
    document.querySelectorAll('#scenario-tabs .tab[data-sc-id="harness"]').forEach(function (tab) {
      if (!engineReady && tab.dataset.amHideWhenDown === '1') tab.style.display = 'none';
    });
    var status = document.getElementById('status-text');
    if (status) {
      var wrap = status.closest('.status-pill') || status.parentElement;
      if (wrap) wrap.style.display = 'none';
    }
    document.querySelectorAll('button').forEach(function (button) {
      var text = (button.textContent || '').trim();
      if (text === '刷新对话' || text.indexOf('Harness') === 0) button.style.display = 'none';
    });

    // 模板自带、与供应链域无关的顶栏入口：外观 / 插件 / 技能目录 / 工具 / 模型 / 个人站 / 集市 / 赞助 / 余额。
    // 它们依赖作者的目录与账号，点开还得再解释一遍；这里统一收起，只留「刷新」与窗口按钮。
    var HIDE_IDS = [
      'btn-theme', 'btn-plugins', 'btn-skills', 'btn-tools', 'btn-models',
      'btn-site', 'btn-market', 'btn-donate', 'balance-chip',
    ];
    HIDE_IDS.forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.style.display = 'none';
    });

    // 「文件夹」下拉：同样依赖作者目录，点了没反应，直接收起
    document.querySelectorAll('#titlebar .tb-btn, #titlebar button').forEach(function (button) {
      var text = (button.textContent || '').trim();
      var title = (button.getAttribute('title') || '');
      if (text === '文件夹' || /文件夹|目录|打开目录/.test(title)) button.style.display = 'none';
    });
  }

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
    hideEngineBits();
  }

  // 启动门兜底：引擎已就绪但界面迟迟报"加载中 92%"卡住时，N 秒后自动点「立即进入」。
  // 模板的按钮本来就写着"等同切场景再切回来"，所以自动点它是安全的；
  // 只是原来需要人盯着点，用户会以为卡死。
  function autoEnterWhenStuck() {
    var ticks = 0;
    var timer = setInterval(function () {
      ticks += 1;
      if (ticks > 40) { clearInterval(timer); return; }
      var text = document.body.innerText || '';
      var stuck = text.indexOf('正在加载界面') >= 0 || text.indexOf('加载中') >= 0;
      if (!stuck) { clearInterval(timer); return; }
      if (ticks < 8) return;   // 大约 16 秒后才接管，给正常加载留时间
      var btn = Array.from(document.querySelectorAll('button')).find(function (b) {
        return (b.textContent || '').indexOf('立即进入') >= 0;
      });
      if (btn) { btn.click(); clearInterval(timer); }
    }, 2000);
  }

  function boot() {
    autoEnterWhenStuck();
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
