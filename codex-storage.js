(function () {
  'use strict';
  var database;
  function open() {
    if (!database) database = new Promise(function(resolve, reject) {
      var req = indexedDB.open('ck-codex-secrets', 1);
      req.onupgradeneeded = function() { req.result.createObjectStore('secrets'); };
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(Error('此浏览器无法打开加密存储')); };
    });
    return database;
  }
  async function read(id) {
    var db = await open();
    return new Promise(function(resolve, reject) {
      var req = db.transaction('secrets').objectStore('secrets').get(id);
      req.onsuccess = function() { resolve(req.result); }; req.onerror = function() { reject(req.error); };
    });
  }
  async function save(secret) {
    var db = await open(), key = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var data = await crypto.subtle.encrypt({name:'AES-GCM', iv:iv}, key, new TextEncoder().encode(secret));
    await new Promise(function(resolve, reject) {
      var tx = db.transaction('secrets','readwrite'), store = tx.objectStore('secrets');
      store.put({key:key, iv:iv, data:data}, 'access');
      tx.oncomplete = resolve; tx.onerror = tx.onabort = function() { reject(Error('加密保存失败，请检查浏览器存储空间')); };
    });
    localStorage.removeItem('ck_codex_access');
  }
  async function load() {
    var legacy = localStorage.getItem('ck_codex_access');
    if (legacy) { await save(legacy); return legacy; }
    var record = await read('access');
    if (!record) return '';
    var data = await crypto.subtle.decrypt({name:'AES-GCM', iv:record.iv}, record.key, record.data);
    return new TextDecoder().decode(data);
  }
  window.CKCodexStorage = {load:load, save:save};
})();
