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

  function normalizeUpdateNotes(notes) {
    if (Array.isArray(notes)) {
      return notes.map(function(x) { return String(x || '').trim(); }).filter(Boolean).slice(0, 12);
    }
    if (typeof notes === 'string') {
      return notes.split(/\r?\n+/).map(function(x) { return x.replace(/^[-*]\s*/, '').trim(); }).filter(Boolean).slice(0, 12);
    }
    return [];
  }

  function normalizeVersionInfo(data, fallbackVersion) {
    var info = { version: String(fallbackVersion || '').trim(), notes: [] };
    if (typeof data === 'string') {
      info.version = String(data || fallbackVersion || '').trim();
      return info;
    }
    if (data && typeof data === 'object') {
      info.version = String(data.version || data.CK_PANEL_VERSION || fallbackVersion || '').trim();
      info.notes = normalizeUpdateNotes(data.notes || data.changelog || data.changes || data.release_notes);
    }
    return info;
  }

  function fetchPanelVersion() {
    var stamp = Date.now();
    return fetch('version.json?__ck_sw_version_check=' + stamp, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) { return normalizeVersionInfo(data); })
      .catch(function() { return normalizeVersionInfo(null); })
      .then(function(info) {
        if (info.version) return info;
        return fetch('index.html?__ck_sw_version_check=' + stamp, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
          .then(function(r) { return r.ok ? r.text() : ''; })
          .then(function(html) {
            var m = String(html || '').match(/CK_PANEL_VERSION=['"]([^'"]+)/);
            return normalizeVersionInfo(m && m[1]);
          })
          .catch(function() { return normalizeVersionInfo(null); });
      });
  }

  function promptPanelUpdate(fallback) {
    fetchPanelVersion().then(function(info) {
      info = info || normalizeVersionInfo(null, fallback || '新版本');
      if (!info.version) info.version = fallback || '新版本';
      if (typeof window.showPanelUpdateModal === 'function') {
        window.showPanelUpdateModal(info);
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
      navigator.serviceWorker.register('./sw.js?v=chat-v93-chat-resilience').then(function(reg) {
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
