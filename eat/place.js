/* Google opening hours and AI review summary in the detail sheet, live from the Supabase function "place".
   Nothing from Google is kept in the page beyond this visit. If the function is not set up, nothing shows. */
window.EatPlace=(function(){
const FN='https://hmipkgllqnyvabcntipb.supabase.co/functions/v1/place',KEY='sb_publishable_9tEEaEglzcirAP7ZRu3DCQ_Weczqod8';
const H={'content-type':'application/json',apikey:KEY,authorization:'Bearer '+KEY};
const C={};
const E=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function get(id){if(id==null)return Promise.resolve(null);if(!C[id])C[id]=fetch(FN,{method:'POST',headers:H,body:JSON.stringify({op:'info',ids:[id],full:true})}).then(r=>r.ok?r.json():{}).then(j=>j[id]||null).catch(()=>null);return C[id]}
const css=document.createElement('style');css.textContent=`
.gp{margin:14px 0 0;font:400 14px/1.6 var(--sans,system-ui,sans-serif)}
.gp-s{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.gp-s i{width:8px;height:8px;border-radius:50%!important;background:#a8a8a8;flex:none}
.gp-s.on i{background:#2fa36b;box-shadow:0 0 0 4px rgba(47,163,107,.15)}.gp-s.off i{background:#d6342a}
.gp-s b{font-weight:600}.gp-s.on b{color:#1f7a4d}.gp-s.off b{color:#b02a21}
.gp-s button{margin-left:auto;font:inherit;font-size:12.5px;color:var(--sub,#7a7772);background:none;border:0;padding:2px 0;cursor:pointer}
.gp ul{list-style:none;margin:8px 0 0;padding:10px 14px;background:#f6f3ee;border-radius:12px!important;font-size:13px;color:#4a4540}
.gp ul li.t{font-weight:600;color:#141414}
.gp-sum{margin-top:14px;padding:12px 14px;background:#f6f3ee;border-radius:14px!important}
.gp-sum h6{margin:0 0 4px!important;font:600 12px var(--sans,sans-serif)!important;letter-spacing:.08em;color:var(--sub,#7a7772)}
.gp-sum p{margin:0!important;font:400 14.5px/1.75 var(--zh,'Noto Serif SC',serif)!important;color:#141414}
.gp-sum small{display:block;margin-top:6px;font-size:11.5px;color:var(--sub,#7a7772)}.gp-sum small a{color:inherit!important;text-decoration:underline}
`;document.head.appendChild(css);
function block(v){
  if(!v||(!v.line&&!v.summary))return null;
  const el=document.createElement('div');el.className='gp';
  const today=(new Date(new Date().toLocaleString('en-US',{timeZone:'Australia/Sydney'})).getDay()+6)%7;
  const cls=v.open===true?'on':v.open===false?'off':'';
  el.innerHTML=(v.line?`<div class="gp-s ${cls}"><i></i><b>${E(v.line)}</b>${(v.week||[]).length?'<button type="button">每周营业时间</button>':''}</div><ul hidden>${(v.week||[]).map((w,k)=>`<li${k===today?' class="t"':''}>${E(w)}</li>`).join('')}</ul>`:'')
   +(v.summary?`<div class="gp-sum"><h6>GOOGLE 评论摘要</h6><p>${E(v.summary)}</p><small>${E(v.disclosure||'由 Google 根据用户评论生成')}${v.reviewsUri?` · <a href="${E(v.reviewsUri)}" target="_blank" rel="noopener">看 Google 评论</a>`:''}</small></div>`:'');
  const b=el.querySelector('.gp-s button');if(b)b.onclick=()=>{const u=el.querySelector('ul');u.hidden=!u.hidden;b.textContent=u.hidden?'每周营业时间':'收起'};
  return el}
/* put the block in once it arrives; ok() says the same shop is still open */
function into(id,ok,put){get(id).then(v=>{if(!ok())return;const b=block(v);if(b)put(b)})}
/* real coordinates for places that have them: [[id, lat, lon], ...] */
let cp=null;function coords(){if(!cp)cp=fetch(FN,{method:'POST',headers:H,body:JSON.stringify({op:'coords'})}).then(r=>r.ok?r.json():[]).catch(()=>[]);return cp}
return {get,into,coords};
})();
