function toggleTheme(){
  document.body.classList.toggle('dark');
  var btn=document.querySelector('.theme-toggle');
  if(document.body.classList.contains('dark')){
    btn.textContent='☀️';
    localStorage.setItem('theme','dark');
  }else{
    btn.textContent='🌙';
    localStorage.setItem('theme','light');
  }
}
if(localStorage.getItem('theme')==='dark'){
  document.body.classList.add('dark');
  var btn=document.querySelector('.theme-toggle');
  if(btn)btn.textContent='☀️';
}
