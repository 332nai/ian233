/* 饭搭子 suggestions shared by the homepage and /eat/ai/: they rotate with Sydney time, weekday and weather */
(function(){
const SYD=(()=>{const p=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',hour:'numeric',hourCycle:'h23',weekday:'short'}).formatToParts(new Date());const g=t=>(p.find(x=>x.type===t)||{}).value;return {h:+g('hour'),d:g('weekday')}})();
const WKEND=SYD.d==='Sat'||SYD.d==='Sun',FRI=SYD.d==='Fri',H=SYD.h;
const DAYZH={Mon:'周一',Tue:'周二',Wed:'周三',Thu:'周四',Fri:'周五',Sat:'周六',Sun:'周日'}[SYD.d]||'今天';
const PART=H<5?'深夜':H<10?'早上':H<14?'中午':H<17?'下午':H<19?'傍晚':H<22?'晚上':'深夜';
const slot=H>=5&&H<10?'m':H>=10&&H<14?'l':H>=14&&H<17?'t':H>=17&&H<21?'d':'n';
let WXK='',WXT='';/* weather kind (rain, hot, cold, nice) and phrase, filled by Open-Meteo */
const CTX=()=>({when:DAYZH+PART,day:DAYZH+(WKEND?'周末':'工作日'),wx:WXT});
/* [question, slot (m l t d n, * any time), condition (wd we fri rain hot cold nice)] */
const Q=[
['{when}，想吃顿像样的早餐','m'],['{when}，附近有早茶吗','m'],['{when}，来杯好咖啡配可颂','m'],['{day}，上班前买个早餐','m','wd'],['{when}，想吃碗热粉当早餐','m'],['{when}，值得排队的 Brunch','m','we'],['{when}，带爸妈喝早茶','m','we'],['{when}，想吃包子豆浆','m'],['{when}，找家 Cafe 坐一会儿','m'],['{day}，CBD 附近的好咖啡','m','wd'],
['{day}，CBD 午饭 20 刀以内','l','wd'],['{day}，CBD 午饭要快','l','wd'],['{day}，一个人吃午饭','l','wd'],['{day}，CBD 能坐下聊事的午饭','l','wd'],['{day}，午饭想吃碗面','l','wd'],['{day}，CBD 想吃点清淡的','l','wd'],['{day}，同事三四个人吃午饭','l','wd'],['{day}，午饭吃越南粉','l','wd'],['{day}，CBD 日料午市','l','wd'],['{day}，午饭想吃饺子','l','wd'],
['{when}，带家人吃午饭','l','we'],['{when}，早茶点心最好的','l','we'],['{when}，午饭吃顿好的','l','we'],['{when}，Chatswood 逛街顺便吃','l','we'],['{when}，Eastwood 吃小吃','l','we'],['{when}，Burwood 午饭吃什么','l','we'],['{when}，午饭人均 25 以内','l'],
['{when}，下午茶吃甜品','t'],['{when}，蛋糕好吃的店','t'],['{when}，想喝杯好咖啡','t'],['{when}，想吃糖水','t'],['{when}，奶茶哪家好','t'],['{when}，抹茶控去哪','t'],['{when}，可颂好吃的','t'],['{day}，下午开会前买杯咖啡','t','wd'],['{when}，带娃吃点心','t','we'],['{when}，Chatswood 下午茶','t'],
['{day}，下班一个人想吃碗面','d','wd'],['{when}，四个人聚餐人均 50','d'],['{when}，带爸妈吃粤菜，要能订位','d'],['{when}，想吃辣的','d'],['{when}，人均 30 以内吃饱','d'],['{when}，约会要有氛围','d','fri'],['{when}，约会要有氛围','d','we'],['{when}，下班喝一杯','d','fri'],['{when}，吃顿好的人均 100','d','we'],['{when}，带娃吃饭，环境宽敞','d','we'],
['{when}，想吃韩烤','d'],['{when}，想吃日式烤肉','d'],['{when}，想吃火锅','d'],['{when}，川菜现炒','d'],['{when}，湘菜下饭','d'],['{when}，想吃东北菜','d'],['{when}，想吃海鲜','d'],['{when}，值得吃的 Omakase','d'],['{when}，意大利菜','d'],['{when}，想吃泰国菜','d'],['{when}，生日聚餐，十个人','d'],['{when}，朋友来悉尼，请吃饭','d'],['{when}，一个人吃也不尴尬','d'],['{day}，加班晚了随便吃点','d','wd'],['{when}，CBD 看完演出吃饭','d'],['{when}，Burwood 晚饭吃什么','d'],['{when}，Chatswood 晚饭','d'],['{when}，Eastwood 晚饭','d'],['{when}，Rhodes 附近晚饭','d'],['{when}，内西有什么好吃的','d'],['{when}，北岸晚饭','d'],['{when}，Surry Hills 吃什么','d'],['{when}，Strathfield 吃韩餐','d'],['{day}，下班 Concord 附近中餐','d','wd'],
['{when}，现在还能吃的宵夜','n'],['{when}，撸串喝啤酒','n'],['{when}，喝一杯的小酒馆','n'],['{when}，来碗粉当宵夜','n'],['{when}，找个酒吧聊天','n'],['{when}，宵夜吃麻辣烫','n'],['{when}，深夜想吃甜的','n'],
['{wx}，想吃火锅','*','rain'],['{wx}，来碗热汤面','*','rain'],['{wx}，不想走远，附近吃什么','*','rain'],['{wx}，想吃砂锅','*','rain'],['{wx}，想吃麻辣烫','*','rain'],['{wx}，打包回家吃的','*','rain'],['{wx}，找家室内暖和的店','*','rain'],
['{wx}，想吃冷面','*','hot'],['{wx}，想吃冰品甜品','*','hot'],['{wx}，吃点清爽的','*','hot'],['{wx}，想去海边吃饭','*','hot'],['{wx}，想吃刺身','*','hot'],['{wx}，来杯冰咖啡','*','hot'],['{wx}，越南菜清爽一点','*','hot'],
['{wx}，想吃火锅','*','cold'],['{wx}，来点暖胃的汤','*','cold'],['{wx}，冷天吃麻辣烫','*','cold'],['{wx}，羊肉粉暖暖身','*','cold'],['{wx}，想喝碗广东汤','*','cold'],['{wx}，韩国汤饭暖一暖','*','cold'],
['{wx}，想坐户外','*','nice'],['{wx}，去花园 Cafe 坐坐','*','nice'],['{wx}，海景餐厅','*','nice'],['{wx}，天台喝一杯','*','nice'],['{wx}，Circular Quay 附近吃饭','*','nice'],
['{wx}，吃点什么好','*','wx'],['{wx}，附近有什么好吃的','*','wx'],['{wx}，想吃顿舒服的','*','wx'],['{wx}，一个人吃什么','*','wx'],
['附近有什么好吃的','*'],['内西有什么好吃的日料','*'],['北岸的五星店','*'],['Chatswood 便宜好吃','*'],['CBD 值得专门去的','*'],['最近新加的店','*'],['Eastwood 小吃','*'],['老杨给了五星的店','*'],['哪些店不推荐去','*'],['人均 20 以内的五星','*'],['排队也值得的','*'],['适合打包回家的','*'],['Hurstville 有什么好吃的','*'],['Lidcombe 吃什么','*'],['Castle Hill 有什么好吃的','*'],['想吃正宗粤菜','*'],['最好吃的拉面','*'],['最好吃的越南粉','*'],['最好吃的小笼包','*'],['适合商务宴请的','*'],['适合带外国朋友去的','*'],['值得开车专门去的','*']
];
const okC=c=>!c||c==='wx'||(c==='wd'?!WKEND:c==='we'?WKEND:c==='fri'?FRI:c===WXK);
const fill=t=>t.replace(/\{(\w+)\}/g,(_,k)=>CTX()[k]||'');
const shuf=a=>a.slice().sort(()=>Math.random()-.5);
let deck={},seen=new Set();
function draw(kind,n){/* deals without repeats until a kind runs out, then reshuffles it */
  const all=Q.filter(([t,s,c])=>okC(c)&&(!/\{wx\}/.test(t)||WXT)&&(kind==='wx'?/\{wx\}/.test(t):kind==='slot'?s===slot&&!/\{wx\}/.test(t):s==='*'&&!/\{wx\}/.test(t))).map(x=>fill(x[0]));
  const out=[];for(let i=0;i<n&&all.length;i++){if(!deck[kind]||!deck[kind].length)deck[kind]=shuf(all.filter(x=>!out.includes(x)));const x=deck[kind].pop();if(x&&!out.includes(x))out.push(x)}return out}
function sugList(){return [...new Set([...draw('wx',1),...draw('slot',WXT?2:3),...draw('any',1)])].slice(0,4)}

const subs=[];
fetch('https://api.open-meteo.com/v1/forecast?latitude=-33.87&longitude=151.21&current=temperature_2m,precipitation,weather_code&timezone=Australia%2FSydney').then(r=>r.json()).then(j=>{const c=j.current||{},t=Math.round(c.temperature_2m),w=c.weather_code||0,rain=(c.precipitation||0)>0||(w>=51&&w<=99);if(!isFinite(t))return;
  const sky=rain?(w>=95?'雷雨':'下雨'):w===0?'晴':w<=3?'多云':w<=48?'有雾':'阴';
  WXK=rain?'rain':t>=28?'hot':t<=14?'cold':w<=3&&t>=18?'nice':'';WXT=`${DAYZH}${PART}${sky} ${t}°C`;deck={};FD.now=WXT;subs.forEach(f=>f())}).catch(()=>{});
window.FD={list:sugList,now:DAYZH+PART,onWeather:f=>{subs.push(f);if(WXT)f()}};
})();
