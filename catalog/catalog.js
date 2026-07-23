(function(){
  var q=document.getElementById('q'),box=document.getElementById('results'),idx=null;
  if(!q)return;
  function load(){return idx?Promise.resolve(idx):fetch('/data/search-index.json').then(function(r){return r.json()}).then(function(j){idx=j.records||[];return idx})}
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function run(){var t=q.value.trim().toLowerCase();if(!t){box.hidden=true;box.innerHTML='';return}
    load().then(function(recs){var m=recs.filter(function(r){return (r.name+' '+r.brand+' '+r.model+' '+r.sku+' '+(r.keywords||[]).join(' ')).toLowerCase().indexOf(t)>=0}).slice(0,20);
      box.innerHTML=m.length?m.map(function(r){return '<a href="'+esc(r.url)+'">'+(r.image?'<img src="'+esc(r.image)+'" alt="">':'')+'<span><b>'+esc(r.name)+'</b><br><small>'+esc(r.top)+'</small></span></a>'}).join(''):'<div style="padding:12px;color:#888">No matches.</div>';
      box.hidden=false})}
  q.addEventListener('input',run);
  document.addEventListener('click',function(e){if(e.target!==q&&!box.contains(e.target))box.hidden=true});
  // product gallery thumbnail switch
  var main=document.getElementById('main-img');
  if(main){document.querySelectorAll('.thumbs img').forEach(function(t){t.addEventListener('click',function(){main.src=t.src})})}
})();