(function(){
  var WA="13313049903";
  var KEY='trendholic_catalog_cart_v1', FKEY='trendholic_catalog_customer_v1';
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function load(){try{return JSON.parse(localStorage.getItem(KEY))||[]}catch(e){return[]}}
  function save(items){try{localStorage.setItem(KEY,JSON.stringify(items))}catch(e){}render()}
  function loadCust(){try{return JSON.parse(localStorage.getItem(FKEY))||{}}catch(e){return{}}}
  function saveCust(c){try{localStorage.setItem(FKEY,JSON.stringify(c))}catch(e){}}
  function count(){return load().reduce(function(n,i){return n+(i.qty||0)},0)}
  function idx(items,slug){for(var i=0;i<items.length;i++)if(items[i].slug===slug)return i;return -1}
  function hasPrice(i){return i.price!=null&&i.price!==''}
  function add(item,qty){var items=load(),i=idx(items,item.slug);qty=Math.max(1,qty||1);
    if(i>=0)items[i].qty+=qty;else{item.qty=qty;items.push(item)}save(items);openDrawer()}
  function setQty(slug,q){var items=load(),i=idx(items,slug);if(i<0)return;items[i].qty=q;if(items[i].qty<=0)items.splice(i,1);save(items)}
  function remove(slug){var items=load(),i=idx(items,slug);if(i>=0)items.splice(i,1);save(items)}

  function render(){
    var c=count(),badge=document.getElementById('cart-count');
    if(badge){badge.textContent=c;badge.hidden=!c}
    var body=document.getElementById('cart-items');if(!body)return;
    var items=load();
    if(!items.length){body.innerHTML='<p class="cart-empty">Your cart is empty. Browse the catalog and add products to build your order.</p>'}
    else{body.innerHTML=items.map(function(i){return '<div class="cart-row" data-slug="'+esc(i.slug)+'">'+
      (i.image?'<img src="'+esc(i.image)+'" alt="" onerror="this.style.visibility=\'hidden\'">':'<div class="cart-ph"></div>')+
      '<div class="cart-meta"><a class="cart-nm" href="'+esc(i.url)+'">'+esc(i.name)+'</a>'+
      (i.ref?'<span class="cart-ref">Ref/Model: '+esc(i.ref)+'</span>':'')+
      (hasPrice(i)?'<span class="cart-pr">'+esc(i.currency||'$')+esc(i.price)+'</span>':'')+'</div>'+
      '<div class="cart-qty"><button type="button" class="q-dec" aria-label="Decrease">−</button>'+
      '<input class="q-in" type="number" min="1" value="'+esc(i.qty)+'" aria-label="Quantity">'+
      '<button type="button" class="q-inc" aria-label="Increase">+</button></div>'+
      '<button type="button" class="cart-rm" aria-label="Remove">✕</button></div>'}).join('')}
    var t=document.getElementById('cart-total-items');if(t)t.textContent=c;
    var co=document.getElementById('cart-checkout');if(co)co.disabled=!items.length;
  }

  function readForm(){var g=function(id){var e=document.getElementById(id);return e?e.value.trim():''};
    return{name:g('cf-name'),company:g('cf-company'),phone:g('cf-phone'),address:g('cf-address')}}
  function fillForm(){var c=loadCust();['name','company','phone','address'].forEach(function(k){var e=document.getElementById('cf-'+k);if(e&&c[k])e.value=c[k]})}

  function buildMessage(){
    var items=load(),cust=readForm();
    var L=['Hello TrendHolic, I would like to place a wholesale order:',''];
    items.forEach(function(i,n){L.push((n+1)+'. '+i.name);
      if(i.ref)L.push('   SKU/Model: '+i.ref);
      L.push('   Quantity: '+i.qty);
      if(hasPrice(i))L.push('   Price: '+(i.currency||'$')+i.price);
      L.push('')});
    L.push('Total Items: '+count());
    L.push('Please confirm availability and final wholesale pricing.');
    L.push('');
    L.push('Customer Name: '+(cust.name||''));
    L.push('Company: '+(cust.company||''));
    L.push('Phone: '+(cust.phone||''));
    L.push('Shipping Address: '+(cust.address||''));
    return L.join('\n');
  }
  function checkout(){if(!load().length)return;saveCust(readForm());
    var url='https://wa.me/'+WA+'?text='+encodeURIComponent(buildMessage());
    window.open(url,'_blank','noopener')}

  var drawer=document.getElementById('cart-drawer');
  function openDrawer(){if(drawer){drawer.hidden=false;document.body.style.overflow='hidden'}}
  function closeDrawer(){if(drawer){drawer.hidden=true;document.body.style.overflow=''}}

  // ---- wiring ----
  var btn=document.getElementById('cart-btn');if(btn)btn.addEventListener('click',openDrawer);
  var co=document.getElementById('cart-checkout');if(co)co.addEventListener('click',checkout);
  var clr=document.getElementById('cart-clear');if(clr)clr.addEventListener('click',function(){if(load().length&&confirm('Clear all items from your order?'))save([])});
  document.addEventListener('click',function(e){
    if(e.target.closest('[data-cart-close]')){closeDrawer();return}
    var addBtn=e.target.closest('.add-cart');
    if(addBtn){var box=addBtn.closest('.buy'),qin=box?box.querySelector('.q-in'):null,q=qin?parseInt(qin.value,10):1;
      add({slug:addBtn.getAttribute('data-slug'),name:addBtn.getAttribute('data-name'),ref:addBtn.getAttribute('data-ref'),
        price:addBtn.getAttribute('data-price'),currency:addBtn.getAttribute('data-currency'),
        image:addBtn.getAttribute('data-image'),url:addBtn.getAttribute('data-url')},q);return}
    var row=e.target.closest('.cart-row');
    if(row){var slug=row.getAttribute('data-slug');
      if(e.target.closest('.cart-rm')){remove(slug);return}
      if(e.target.closest('.q-inc')){var i=idx(load(),slug);setQty(slug,(load()[i].qty||0)+1);return}
      if(e.target.closest('.q-dec')){var j=idx(load(),slug);setQty(slug,(load()[j].qty||0)-1);return}}
  });
  // product-page quantity stepper (buy box, not in cart drawer)
  document.querySelectorAll('.buy .qtyctl').forEach(function(ctl){
    var input=ctl.querySelector('.q-in');
    ctl.querySelector('.q-inc').addEventListener('click',function(){input.value=Math.max(1,(parseInt(input.value,10)||1)+1)});
    ctl.querySelector('.q-dec').addEventListener('click',function(){input.value=Math.max(1,(parseInt(input.value,10)||1)-1)});
  });
  // cart-row qty typing
  document.addEventListener('change',function(e){var row=e.target.closest('.cart-row');
    if(row&&e.target.classList.contains('q-in')){setQty(row.getAttribute('data-slug'),Math.max(1,parseInt(e.target.value,10)||1))}});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeDrawer()});
  // reflect cart changes made in another tab
  window.addEventListener('storage',function(e){if(e.key===KEY)render()});
  fillForm();render();
})();