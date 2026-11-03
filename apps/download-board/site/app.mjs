export function validNotes(notes){return Array.isArray(notes)&&notes.length>0&&notes.every(n=>typeof n==='string'&&n.trim().length>0);}
export function isDownloadReady(r){return r&&r.qaStatus==='PASS'&&r.status==='published'&&['aos','ios'].includes(r.platform)&&typeof r.file==='string'&&/^\/downloads\/[a-zA-Z0-9._/-]+\.(apk|ipa|zip)$/.test(r.file)&&!r.file.includes('..')&&typeof r.version==='string'&&r.version.length>0&&typeof r.sha256==='string'&&/^[a-f0-9]{64}$/.test(r.sha256)&&Number.isSafeInteger(r.bytes)&&r.bytes>0&&validNotes(r.notes);}
export function visibleReleases(releases,platform='all',query=''){const q=query.trim().toLocaleLowerCase();return releases.filter(isDownloadReady).filter(r=>platform==='all'||r.platform===platform).filter(r=>[r.version,r.build,...r.notes].join(' ').toLocaleLowerCase().includes(q)).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt));}
export function formatBytes(bytes){return bytes<1000000?`${(bytes/1000).toFixed(1)} KB`:`${(bytes/1000000).toFixed(1)} MB`;}
export function formatDate(value){const d=new Date(value);return Number.isNaN(d.getTime())?'일시 확인 중':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(d);}
if(typeof document!=='undefined'){
 let platform='all',items=[],loadState='loading';const result=document.querySelector('#result');
 const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
 const render=()=>{
  result.replaceChildren();
  if(loadState==='error'){document.querySelector('#count').textContent='—';result.append(el('p','목록을 불러오지 못했습니다. 새로고침해 주세요.','error'));return;}
  if(loadState==='loading'){result.append(el('p','불러오는 중…','empty'));return;}
  const shown=visibleReleases(items,platform,document.querySelector('#search').value);document.querySelector('#count').textContent=String(shown.length);
  if(!shown.length){result.append(el('p',items.length?'검색 결과가 없습니다.':'등록된 앱이 없습니다.','empty'));return;}
  for(const r of shown){
   const article=el('article',undefined,'release'),head=el('div',undefined,'release-head'),info=el('div');
   info.append(el('span',r.platform==='aos'?'AOS':'iOS','platform-label'),el('h2',`v${r.version} · Build ${r.build}`),el('p',`${r.kindLabel} · ${formatBytes(r.bytes)} · ${formatDate(r.builtAt)}`,'meta'));
   const a=el('a','다운로드','download');a.href=r.file;a.download=r.file.split('/').at(-1);head.append(info,a);article.append(head,el('p',r.installationNotice,'warning'));
   const ul=el('ul');for(const note of r.notes)ul.append(el('li',note));article.append(ul);
   const details=el('details');details.append(el('summary','파일 정보'),el('p',`SHA-256 ${r.sha256}`));article.append(details);result.append(article);
  }
 };
 document.querySelectorAll('[data-platform]').forEach(button=>button.addEventListener('click',()=>{platform=button.dataset.platform;document.querySelectorAll('[data-platform]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();}));
 document.querySelector('#search').addEventListener('input',render);
 fetch('/releases.json',{cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error('manifest unavailable');const data=await response.json();if(!Array.isArray(data.releases))throw new Error('invalid manifest');items=data.releases.filter(isDownloadReady);loadState='ready';render();}).catch(()=>{loadState='error';render();});
}
