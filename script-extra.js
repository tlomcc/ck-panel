(function(){
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

  applyTheme(localStorage.getItem('theme')||'dark');
})();
