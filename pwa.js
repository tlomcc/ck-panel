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
        location.reload();
      });
      navigator.serviceWorker.register('./sw.js?v=chat-v10').then(function(reg) {
        if (reg && reg.update) reg.update();
      }).catch(function() {});
    }

    updateInstallButton();
  });
})();
