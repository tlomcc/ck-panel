(function(){
  var THEME_PALETTE_VERSION='fresh-green-folio-v1';

  function applyTheme(theme){
    var isDark=theme==='dark';
    document.body.classList.toggle('dark',isDark);
    var btn=document.querySelector('.theme-toggle');
    if(btn){
      btn.textContent=isDark?'☀️':'🌙';
      btn.setAttribute('aria-label',isDark?'切换浅色模式':'切换深色模式');
    }
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
