(function() {
  var deferredPrompt = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function installButton() {
    return document.getElementById('install-app-btn');
  }

  function updateInstallButton() {
    var btn = installButton();
    if (!btn) return;
    btn.classList.toggle('show', !!deferredPrompt && !isStandalone());
  }

  function showInstallMessage(message) {
    if (typeof window.toast === 'function') window.toast(message);
  }

  function fetchPanelVersion() {
    var stamp = Date.now();
    return fetch('version.json?__ck_sw_version_check=' + stamp, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        var version = data && (data.version || data.CK_PANEL_VERSION);
        if (version) return String(version);
        return '';
      })
      .catch(function() { return ''; })
      .then(function(version) {
        if (version) return version;
        return fetch('index.html?__ck_sw_version_check=' + stamp, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
          .then(function(r) { return r.ok ? r.text() : ''; })
          .then(function(html) {
            var m = String(html || '').match(/CK_PANEL_VERSION=['"]([^'"]+)/);
            return (m && m[1]) || '';
          })
          .catch(function() { return ''; });
      });
  }

  function promptPanelUpdate(fallback) {
    fetchPanelVersion().then(function(latest) {
      latest = latest || fallback || '新版本';
      if (typeof window.showPanelUpdateModal === 'function') {
        window.showPanelUpdateModal(latest);
      } else {
        location.reload();
      }
    }).catch(function() {
      if (typeof window.showPanelUpdateModal === 'function') window.showPanelUpdateModal(fallback || '新版本');
      else location.reload();
    });
  }

  window.addEventListener('beforeinstallprompt', function(event) {
    event.preventDefault();
    deferredPrompt = event;
    updateInstallButton();
  });

  window.addEventListener('appinstalled', function() {
    deferredPrompt = null;
    updateInstallButton();
    showInstallMessage('已安装到桌面');
  });

  document.addEventListener('DOMContentLoaded', function() {
    var btn = installButton();
    if (btn) {
      btn.addEventListener('click', function() {
        if (!deferredPrompt) {
          showInstallMessage('当前浏览器暂未开放安装');
          return;
        }
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function() {
          deferredPrompt = null;
          updateInstallButton();
        });
      });
    }

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      var refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function() {
        if (refreshing) return;
        refreshing = true;
        try {
          if (document.body && document.body.classList.contains('chat-active')) {
            localStorage.setItem('ckPanelAfterUpdateTab', 'chat');
          }
        } catch (e) {}
        promptPanelUpdate('新版本');
      });
      navigator.serviceWorker.register('./sw.js?v=chat-v54').then(function(reg) {
        reg.addEventListener('updatefound', function() {
          var worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', function() {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              promptPanelUpdate('新版本');
            }
          });
        });
        if (reg && reg.update) reg.update();
      }).catch(function() {});
    }

    updateInstallButton();
  });
})();
