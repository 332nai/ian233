/* 网友评论: approved reviews under the review text, and a form behind the sheet's 评论 button.
   Anyone can write with a nickname; nothing shows until the site owner approves it. */
window.EatReviews=(function(){
const U='https://hmipkgllqnyvabcntipb.supabase.co',K='sb_publishable_9tEEaEglzcirAP7ZRu3DCQ_Weczqod8';
const H={'content-type':'application/json',apikey:K,authorization:'Bearer '+K};
const E=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ls={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}}};
let dev=ls.get('eat-dev');if(!dev){dev=(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)+Date.now());ls.set('eat-dev',dev)}
const rpc=(f,b)=>fetch(`${U}/rest/v1/rpc/${f}`,{method:'POST',headers:H,body:JSON.stringify(b)});
const C={};
function list(rid){if(!C[rid])C[rid]=rpc('reviews_for',{p_rid:rid}).then(r=>r.ok?r.json():[]).catch(()=>[]);return C[rid]}
const css=document.createElement('style');css.textContent=`
.urv{margin-top:22px}
.urv h6{display:flex;align-items:baseline;gap:8px;margin:0 0 8px!important;font:600 12px var(--sans,sans-serif)!important;letter-spacing:.08em;color:var(--sub,#7a7772)}
.urv h6 b{font:700 13px var(--sans,sans-serif);letter-spacing:0;color:#d6342a}
.urv-i{padding:12px 0;border-top:1px solid #ece8e1}
.urv-m{display:flex!important;gap:8px;align-items:center;font-size:13px;color:var(--sub,#7a7772)}
.urv-m b{color:#141414;font-weight:600}.urv-m i{font-style:normal;color:#d6342a!important;letter-spacing:1px}
.urv-i p{margin:4px 0 0!important;font:400 15px/1.75 var(--zh,'Noto Serif SC',serif)!important;color:#141414}
.urv-more{font:inherit;font-size:13px;color:var(--sub,#7a7772);background:none;border:0;padding:8px 0;cursor:pointer}
#rvf{position:fixed;inset:0;z-index:9000;display:none;align-items:flex-end;justify-content:center;background:rgba(20,20,20,.45);backdrop-filter:blur(3px)}
#rvf.on{display:flex}
#rvf form{width:min(560px,100%);background:#fffdf9;border-radius:24px 24px 0 0!important;padding:20px 22px calc(18px + env(safe-area-inset-bottom));animation:rvup .3s cubic-bezier(.2,.8,.2,1);font-family:var(--sans,system-ui,sans-serif)}
@media(min-width:700px){#rvf{align-items:center}#rvf form{border-radius:24px!important}}
@keyframes rvup{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}
#rvf .rvh{display:flex;max-width:none;margin:0;padding:0;background:none;justify-content:space-between;align-items:center}
#rvf .rvh b{font:900 20px/1.3 var(--zh,'Noto Serif SC',serif)}#rvf .rvh button{background:none;border:0;font-size:14px;color:var(--sub,#7a7772);cursor:pointer}
#rvf .sn{font-size:13px;color:var(--sub,#7a7772);margin-top:2px}
#rvf .st{display:flex;gap:6px;margin:16px 0 6px}
#rvf .st button{background:none;border:0;padding:0;font-size:34px;line-height:1;color:#e4ded5;cursor:pointer;transition:transform .15s}
#rvf .st button.on{color:#d6342a}#rvf .st button:active{transform:scale(1.2)}
#rvf input,#rvf textarea{width:100%;box-sizing:border-box;border:0;background:#f3efe8;border-radius:12px!important;padding:12px 14px;font:16px var(--sans,system-ui,sans-serif);outline:none;margin-top:10px}
#rvf textarea{height:120px;resize:none;line-height:1.6}
#rvf input:focus,#rvf textarea:focus{box-shadow:0 0 0 3px rgba(214,52,42,.18)}
#rvf .rvb{display:flex;align-items:center;gap:12px;margin-top:14px}
#rvf .rvb span{flex:1;font-size:12.5px;color:var(--sub,#7a7772)}
#rvf .rvb button{height:46px;padding:0 26px;border:0;border-radius:14px!important;background:#141414;color:#fff;font:600 15px var(--sans,sans-serif);cursor:pointer}
#rvf .rvb button:disabled{opacity:.4}
#rvf .ok{text-align:center;padding:26px 0 10px}#rvf .ok b{display:block;font:900 22px var(--zh,serif);margin-bottom:6px}#rvf .ok p{margin:0;color:var(--sub,#7a7772)}
`;document.head.appendChild(css);
const S5=n=>'★'.repeat(n)+'<span style="opacity:.25">'+'★'.repeat(5-n)+'</span>';
function day(t){const d=new Date(t);return `${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()}`}
/* approved reviews, put before the action bar; ok() says the same shop is still open */
function into(rid,ok,put){list(rid).then(a=>{if(!ok()||!a.length)return;
  const el=document.createElement('div');el.className='urv';const avg=a.reduce((s,x)=>s+x.stars,0)/a.length;
  const item=x=>`<div class="urv-i"><div class="urv-m"><b>${E(x.name)}</b><i>${S5(x.stars)}</i><span>${day(x.created_at)}</span></div><p>${E(x.body)}</p></div>`;
  el.innerHTML=`<h6>网友评论 <b>${avg.toFixed(1)}</b> · ${a.length} 条</h6>${a.slice(0,3).map(item).join('')}${a.length>3?`<button type="button" class="urv-more">再看 ${a.length-3} 条</button>`:''}`;
  const m=el.querySelector('.urv-more');if(m)m.onclick=()=>{m.insertAdjacentHTML('beforebegin',a.slice(3).map(item).join(''));m.remove()};
  put(el)})}
let F=null,cur=null;
function form(rid,name){cur=rid;
  if(!F){F=document.createElement('div');F.id='rvf';document.body.appendChild(F);F.addEventListener('click',e=>{if(e.target===F)close()})}
  let stars=0;
  F.innerHTML=`<form><div class="rvh"><b>写评论</b><button type="button" class="x">取消</button></div><div class="sn">${E(name)}</div>
   <div class="st">${[1,2,3,4,5].map(i=>`<button type="button" data-s="${i}" aria-label="${i} 星">★</button>`).join('')}</div>
   <input name="n" maxlength="20" placeholder="昵称" value="${E(ls.get('eat-nick')||'')}" autocomplete="nickname">
   <textarea name="b" maxlength="500" placeholder="好吃吗？推荐点什么？要注意什么？"></textarea>
   <div class="rvb"><span>审核通过后显示</span><button type="submit" disabled>提交</button></div></form>`;
  const f=F.querySelector('form'),btn=f.querySelector('[type=submit]'),msg=f.querySelector('.rvb span');
  const check=()=>{btn.disabled=!(stars&&f.n.value.trim()&&f.b.value.trim().length>=2)};
  f.querySelectorAll('.st button').forEach(b=>b.onclick=()=>{stars=+b.dataset.s;f.querySelectorAll('.st button').forEach(x=>x.classList.toggle('on',+x.dataset.s<=stars));check()});
  f.oninput=check;f.querySelector('.x').onclick=close;
  f.onsubmit=async e=>{e.preventDefault();btn.disabled=true;msg.textContent='提交中…';
    let r='net';try{const res=await rpc('review_submit',{p_rid:rid,p_name:f.n.value,p_stars:stars,p_body:f.b.value,p_dev:dev});r=res.ok?await res.json():'net'}catch(x){}
    if(r==='ok'){ls.set('eat-nick',f.n.value.trim());f.innerHTML=`<div class="ok"><b>谢谢！</b><p>审核通过后就会显示在这家店下面。</p></div>`;setTimeout(close,1800);return}
    msg.textContent={limit:'今天写得有点多了，明天再来吧。',busy:'评论太多还没审完，晚点再试。',name:'昵称 1 到 20 个字。',body:'评论至少 2 个字，最多 500 字。'}[r]||'没提交成功，检查一下网络再试。';check()};
  F.classList.add('on');document.documentElement.style.overflow='hidden'}
function close(){if(F){F.classList.remove('on');F.innerHTML=''}document.documentElement.style.overflow=''}
addEventListener('keydown',e=>{if(e.key==='Escape'&&F&&F.classList.contains('on'))close()});
/* wire the sheet: approved reviews above the buttons, and the 评论 button opens the form */
function attach(rid,root,name,ok){if(rid==null||!root)return;
  const b=root.querySelector('.grev');if(b){b.removeAttribute('href');b.removeAttribute('target');b.setAttribute('role','button');b.onclick=e=>{e.preventDefault();form(rid,name)}}
  into(rid,()=>(!ok||ok())&&root.isConnected&&!root.querySelector('.urv'),el=>{const a=root.querySelector('.acts');a?a.before(el):root.appendChild(el)})}
return {attach,form,list};
})();
