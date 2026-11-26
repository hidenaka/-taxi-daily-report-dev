import { isHoliday } from '../../js/jp-holidays.js';

// 乗り場から出た台数を日ごとに見るページ(2026-11-26)。データは Mac mini が毎朝作る tools/data/stand-days.json。

let DATA=[];
const DOWN=["日","月","火","水","木","金","土"];
const dowOf=d=>new Date(d+"T00:00:00Z").getUTCDay();
const grp=d=>isHoliday(d)||dowOf(d)===0?"sun":dowOf(d)===6?"sat":"wd";
const dkey=d=>isHoliday(d)?"祝":DOWN[dowOf(d)];
const delayLv=b=>b==null?"none":b>=10000?"big":b>=4000?"mid":"none";
const LANES=[["all","4つの号の合計"],["1","1号"],["2","2号"],["3","3号"],["4","4号"]];
const DK=["月","火","水","木","金","土","日","祝"];
const DL=[["none","ふつうの日"],["mid","少し遅れた日（4000〜1万席）"],["big","大きく遅れた日（1万席以上）"]];
const S={lane:"all",dows:new Set(DK),delays:new Set(["none","mid","big"]),from:"",to:"",sort:"date",sel:null,tsort:null};
try{const v=localStorage.getItem("sd-lane");if(v)S.lane=v}catch(e){}
function hours(r){if(S.lane==="all"){if(!["1","2","3","4"].every(k=>r.h[k]))return null;return Array.from({length:24},(_,i)=>["1","2","3","4"].reduce((a,k)=>a+r.h[k][i],0))}return r.h[S.lane]||null}
function rows(){return DATA.filter(r=>r.d>=S.from&&r.d<=S.to&&S.dows.has(dkey(r.d))&&S.delays.has(delayLv(r.big))).map(r=>({...r,hh:hours(r)})).filter(r=>r.hh).map(r=>({...r,tot:r.hh.reduce((a,b)=>a+b,0)}))}
function sorted(rs){const a=[...rs];if(S.sort==="desc")a.sort((x,y)=>y.tot-x.tot);else if(S.sort==="asc")a.sort((x,y)=>x.tot-y.tot);else if(S.sort==="dow")a.sort((x,y)=>DK.indexOf(dkey(x.d))-DK.indexOf(dkey(y.d))||x.d.localeCompare(y.d));return a}
const col=d=>({wd:"var(--wd)",sat:"var(--sat)",sun:"var(--sun)"})[grp(d)];
const fmt=d=>{const [y,m,dd]=d.split("-");return `${+m}/${+dd}`};
function chips(el,items,isOn,onClick){el.innerHTML="";for(const [k,l] of items){const b=document.createElement("button");b.type="button";b.className="chip";b.textContent=l;b.setAttribute("aria-pressed",isOn(k));b.onclick=()=>{onClick(k);draw()};el.appendChild(b)}}
function draw(){
  chips(document.getElementById("f-lane"),LANES,k=>S.lane===k,k=>{S.lane=k;try{localStorage.setItem("sd-lane",k)}catch(e){}});
  chips(document.getElementById("f-dow"),DK.map(k=>[k,k]),k=>S.dows.has(k),k=>{S.dows.has(k)?S.dows.delete(k):S.dows.add(k)});
  chips(document.getElementById("f-delay"),DL,k=>S.delays.has(k),k=>{S.delays.has(k)?S.delays.delete(k):S.delays.add(k)});
  const rs=rows(),avg=rs.length?rs.reduce((a,r)=>a+r.tot,0)/rs.length:0;
  const mx=rs.reduce((a,r)=>r.tot>a.tot?r:a,rs[0]||{tot:0}),mn=rs.reduce((a,r)=>r.tot<a.tot?r:a,rs[0]||{tot:0});
  document.getElementById("stats").innerHTML=rs.length?`<div class="stat"><b>${rs.length}日</b><span>選んだ日</span></div><div class="stat"><b>${Math.round(avg)}台</b><span>1日の平均</span></div><div class="stat"><b>${mx.tot}台</b><span>いちばん多い日 ${fmt(mx.d)}(${dkey(mx.d)})</span></div><div class="stat"><b>${mn.tot}台</b><span>いちばん少ない日 ${fmt(mn.d)}(${dkey(mn.d)})</span></div>`:`<p>この条件に合う日がありません。曜日か遅れ便の選び方を広げてください。${S.lane==="all"?"「4つの号の合計」は、4つとも数えた10/14からの日だけです。":""}</p>`;
  drawDays(sorted(rs),avg);drawDow(rs);drawHour(rs);drawTable(rs);
}
function drawDays(rs,avg){
  const svg=document.getElementById("c-days"),bw=Math.max(14,Math.min(28,1000/Math.max(rs.length,1))),H=210,top=10,bot=34,W=Math.max(rs.length*bw+40,300);
  svg.setAttribute("viewBox",`0 0 ${W} ${H}`);svg.style.width=W+"px";svg.style.maxWidth=rs.length*bw+40<1000?"100%":"none";
  const max=Math.max(1,...rs.map(r=>r.tot))*1.08,y=v=>top+(H-top-bot)*(1-v/max);
  let g="";
  for(const t of ticks(max)){g+=`<line x1="34" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="30" y="${y(t)+3}" text-anchor="end">${t}</text>`}
  rs.forEach((r,i)=>{const x=36+i*bw,h=y(0)-y(r.tot);const c=r.d===S.sel?"var(--hl)":col(r.d);
    g+=`<rect class="bar" data-d="${r.d}" x="${x+1}" y="${y(r.tot)}" width="${bw-2}" height="${h}" rx="2" fill="${c}"><title>${fmt(r.d)}(${dkey(r.d)}) ${r.tot}台${r.big!=null?" ・遅れ席 "+r.big:""}</title></rect>`;
    if(rs.length<=60||i%2===0)g+=`<text x="${x+bw/2}" y="${H-20}" text-anchor="middle">${fmt(r.d)}</text>`;
    g+=`<text x="${x+bw/2}" y="${H-7}" text-anchor="middle" style="fill:${col(r.d)}">${dkey(r.d)}</text>`});
  if(rs.length)g+=`<line x1="34" x2="${W}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--fg)" stroke-dasharray="4 3"/>`;
  svg.innerHTML=g;svg.querySelectorAll(".bar").forEach(b=>b.onclick=()=>{S.sel=b.dataset.d;draw()});
}
function ticks(max){const step=max>2000?500:max>800?200:max>300?100:50;const a=[];for(let t=0;t<max;t+=step)a.push(t);return a}
function drawDow(rs){
  const svg=document.getElementById("c-dow"),W=420,H=200,top=10,bot=24;svg.setAttribute("viewBox",`0 0 ${W} ${H}`);
  const by=DK.map(k=>rs.filter(r=>dkey(r.d)===k));const max=Math.max(1,...rs.map(r=>r.tot))*1.08;const lo=Math.min(...rs.map(r=>r.tot),max)*0.85;
  const y=v=>top+(H-top-bot)*(1-(v-lo)/(max-lo||1));const bw=(W-40)/8;let g="";
  for(const t of ticks(max).filter(t=>t>=lo))g+=`<line x1="34" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="30" y="${y(t)+3}" text-anchor="end">${t}</text>`;
  by.forEach((list,i)=>{const x=38+i*bw;const k=DK[i];const c=k==="祝"||k==="日"?"var(--sun)":k==="土"?"var(--sat)":"var(--wd)";
    if(list.length){const m=list.reduce((a,r)=>a+r.tot,0)/list.length;g+=`<rect x="${x+6}" y="${y(m)}" width="${bw-12}" height="${y(lo)-y(m)}" rx="2" fill="${c}" opacity=".35"/><line x1="${x+6}" x2="${x+bw-6}" y1="${y(m)}" y2="${y(m)}" stroke="${c}" stroke-width="2.5"/><text x="${x+bw/2}" y="${y(m)-4}" text-anchor="middle" style="fill:var(--fg)">${Math.round(m)}</text>`;
      list.forEach((r,j)=>g+=`<circle cx="${x+bw/2+((j%3)-1)*5}" cy="${y(r.tot)}" r="2.6" fill="${r.d===S.sel?"var(--hl)":c}"><title>${fmt(r.d)} ${r.tot}台</title></circle>`)}
    g+=`<text x="${x+bw/2}" y="${H-8}" text-anchor="middle">${k}(${list.length})</text>`});
  svg.innerHTML=g;
}
function drawHour(rs){
  const svg=document.getElementById("c-hour"),W=420,H=200,top=10,bot=22;svg.setAttribute("viewBox",`0 0 ${W} ${H}`);
  const r=rs.find(x=>x.d===S.sel)||null;const avg=Array.from({length:24},(_,h)=>rs.length?rs.reduce((a,x)=>a+x.hh[h],0)/rs.length:0);
  const max=Math.max(1,...avg,...(r?r.hh:[]))*1.1,y=v=>top+(H-top-bot)*(1-v/max),bw=(W-36)/24;let g="";
  for(const t of ticks(max))g+=`<line x1="30" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="26" y="${y(t)+3}" text-anchor="end">${t}</text>`;
  if(r)r.hh.forEach((v,h)=>g+=`<rect x="${32+h*bw+1}" y="${y(v)}" width="${bw-2}" height="${y(0)-y(v)}" rx="1.5" fill="var(--hl)"><title>${h}時 ${v}台</title></rect>`);
  let pts="";avg.forEach((v,h)=>pts+=`${32+h*bw},${y(v)} ${32+(h+1)*bw},${y(v)} `);g+=`<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  for(const h of [0,6,12,18,23])g+=`<text x="${32+h*bw+bw/2}" y="${H-6}" text-anchor="middle">${h}時</text>`;
  svg.innerHTML=g;
  document.getElementById("d-title").textContent=r?`1日の中身 ${fmt(r.d)}(${dkey(r.d)}) ${r.tot}台`:"1日の中身";
  document.getElementById("d-note").textContent=r?`棒＝${fmt(r.d)}。線＝選んだ${rs.length}日の平均。${r.big!=null?"遅れ席 "+r.big.toLocaleString()+"席。":""}`:"上の棒か表の行を押すと、その日の1時間ごとが出ます。線＝選んだ日の平均。";
}
function drawTable(rs){
  const cols=[["d","日付"],["w","曜日"],["big","遅れ席"],["1","1号"],["2","2号"],["3","3号"],["4","4号"],["sum","合計"]];
  const val=(r,k)=>k==="d"?r.d:k==="w"?DK.indexOf(dkey(r.d)):k==="big"?(r.big??-1):k==="sum"?(["1","2","3","4"].every(x=>r.h[x])?["1","2","3","4"].reduce((a,x)=>a+r.h[x].reduce((p,q)=>p+q,0),0):-1):(r.h[k]?r.h[k].reduce((p,q)=>p+q,0):-1);
  document.getElementById("t-head").innerHTML=cols.map(([k,l])=>`<th data-k="${k}" scope="col">${l}${S.tsort&&S.tsort[0]===k?(S.tsort[1]>0?" ▲":" ▼"):""}</th>`).join("");
  let a=[...rs];if(S.tsort){const [k,dir]=S.tsort;a.sort((x,y)=>{const p=val(x,k),q=val(y,k);return (p>q?1:p<q?-1:0)*dir})}else a=sorted(rs);
  document.getElementById("t-body").innerHTML=a.map(r=>`<tr data-d="${r.d}" class="${r.d===S.sel?"sel":""}">`+cols.map(([k])=>{const v=val(r,k);return `<td>${k==="d"?fmt(r.d):k==="w"?`<span style="color:${col(r.d)}">${dkey(r.d)}</span>`:v<0?"—":v.toLocaleString()}</td>`}).join("")+"</tr>").join("");
  document.querySelectorAll("#t-head th").forEach(th=>th.onclick=()=>{const k=th.dataset.k;S.tsort=S.tsort&&S.tsort[0]===k?[k,-S.tsort[1]]:[k,k==="d"||k==="w"?1:-1];draw()});
  document.querySelectorAll("#t-body tr").forEach(tr=>tr.onclick=()=>{S.sel=tr.dataset.d;draw()});
}
document.getElementById("dow-all").onclick=()=>{S.dows=new Set(DK);draw()};
document.getElementById("dow-wd").onclick=()=>{S.dows=new Set(["月","火","水","木","金"]);draw()};
document.getElementById("dow-we").onclick=()=>{S.dows=new Set(["土","日","祝"]);draw()};
const ff=document.getElementById("f-from"),ft=document.getElementById("f-to"),fs=document.getElementById("f-sort");
ff.onchange=()=>{S.from=ff.value||DATA[0].d;draw()};ft.onchange=()=>{S.to=ft.value||DATA[DATA.length-1].d;draw()};
fs.onchange=()=>{S.sort=fs.value;S.tsort=null;draw()};
function setData(rows){
  const lastOld=DATA.length?DATA[DATA.length-1].d:"",followTo=!S.to||S.to===lastOld,followSel=!S.sel||S.sel===lastOld;
  DATA=rows;const first=DATA[0].d,last=DATA[DATA.length-1].d;
  if(!S.from||S.from<first)S.from=first;if(followTo||S.to>last)S.to=last;if(followSel)S.sel=last;
  ff.min=ft.min=first;ff.max=ft.max=last;ff.value=S.from;ft.value=S.to;
  document.getElementById("span").textContent=`${fmt(first)}〜${fmt(last)}の${DATA.length}日分（丸1日数えた日）。毎朝、前の日までの分が足されます。`;
  draw();
}
export function normalizeDays(j){
  return (j&&Array.isArray(j.days)?j.days:[]).filter(x=>x&&/^\d{4}-\d\d-\d\d$/.test(x.d)&&x.h&&typeof x.h==="object")
    .map(x=>({d:x.d,big:typeof x.big==="number"?x.big:null,h:Object.fromEntries(["1","2","3","4"].filter(k=>Array.isArray(x.h[k])&&x.h[k].length===24).map(k=>[k,x.h[k].map(v=>+v||0)]))}))
    .filter(x=>Object.keys(x.h).length).sort((a,b)=>a.d.localeCompare(b.d));
}
async function load(){
  try{
    const r=await fetch("./data/stand-days.json",{cache:"no-store"});
    if(!r.ok)throw new Error("HTTP "+r.status);
    const rows=normalizeDays(await r.json());
    if(!rows.length)throw new Error("empty");
    setData(rows);
  }catch(e){
    document.getElementById("span").textContent="";
    const el=document.getElementById("sd-error");el.hidden=false;el.textContent="日ごとの台数を読みこめませんでした。通信のよいところで開き直してください。";
  }
}
if(typeof document!=="undefined"&&document.getElementById("sd-root"))load();
