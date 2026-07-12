(function(){
  var THEME_PALETTE_VERSION='fresh-green-folio-v3';

  function applyTheme(theme){
    var isDark=theme==='dark';
    document.body.classList.toggle('dark',isDark);
    var themeMeta=document.querySelector('meta[name="theme-color"]');
    if(themeMeta)themeMeta.setAttribute('content',isDark?'#1c1c1e':'#f7f7f7');
    document.querySelectorAll('.theme-toggle').forEach(function(btn){
      btn.classList.toggle('is-dark',isDark);
      if(!btn.classList.contains('chat-theme-toggle'))btn.textContent=isDark?'☀️':'🌙';
      btn.setAttribute('aria-label',isDark?'切换浅色模式':'切换深色模式');
      btn.setAttribute('title',isDark?'切换浅色模式':'切换深色模式');
    });
  }

  window.toggleTheme=function(){
    var next=document.body.classList.contains('dark')?'light':'dark';
    localStorage.setItem('theme',next);
    applyTheme(next);
  };

  if(localStorage.getItem('themePalette')!==THEME_PALETTE_VERSION){
    localStorage.setItem('theme','light');
    localStorage.setItem('themePalette',THEME_PALETTE_VERSION);
  }

  applyTheme(localStorage.getItem('theme')||'light');
})();
