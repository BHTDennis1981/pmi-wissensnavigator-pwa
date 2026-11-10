
'use strict';
/* PMI Wissensnavigator V011: purely local, read-only, offline. Untrusted content is escaped. */
(function(){
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let bundle=null,faqMap=new Map(),nodeMap=new Map(),edgeMap=new Map(),anns={},qas=new Map(),evidence=new Map(),derived=new Map(),network=null,graphLastHash='';
let syncPending=null, syncLastReport=null, syncLastAcceptedBundle=null;
/* V012 PWA: Alle Wissensdaten ausschließlich lokal (IndexedDB), kein Serverupload. */
const PWA_DB_NAME='pmi-wissensnavigator-v012';
const PWA_STORE='local-bundles';
let pwaDeferredInstall=null;
function pwaDb(){return new Promise((resolve,reject)=>{
 if(!('indexedDB' in window)){reject(new Error('IndexedDB nicht verfügbar'));return}
 let req=indexedDB.open(PWA_DB_NAME,1);
 req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(PWA_STORE))db.createObjectStore(PWA_STORE)};
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('Lokale Datenbank blockiert'));
});}
async function pwaStoreBundle(next){
 try{
  const db=await pwaDb();
  await new Promise((resolve,reject)=>{
   let tx=db.transaction(PWA_STORE,'readwrite');tx.objectStore(PWA_STORE).put(next,'active');
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Speichern abgebrochen'));
  });db.close();
  const info=document.getElementById('pwaLocalStatus');if(info)info.textContent='Wissensdaten ausschließlich auf diesem Gerät gespeichert.';
 }catch(e){console.warn('Lokaler Speicher nicht verfügbar:',e);toast('Lokale Speicherung fehlgeschlagen. Bitte Daten über Menü exportieren!');}
}
async function pwaReadBundle(){let db=await pwaDb();try{return await new Promise((resolve,reject)=>{
 let tx=db.transaction(PWA_STORE,'readonly');let req=tx.objectStore(PWA_STORE).get('active');req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
});}finally{db.close()}}
async function pwaDeleteBundle(){let db=await pwaDb();try{await new Promise((resolve,reject)=>{
 let tx=db.transaction(PWA_STORE,'readwrite');tx.objectStore(PWA_STORE).delete('active');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
});}finally{db.close()}}
function pwaShowWelcome(show){const el=document.getElementById('pwaWelcome');if(el)el.hidden=!show;}
function pwaSetup(){
 document.getElementById('pwaWelcomeImport').onclick=()=>document.getElementById('fileImport').click();
 const del=document.getElementById('pwaClearLocal');del.onclick=async()=>{
  if(!confirm('Wirklich alle lokal gespeicherten Wissensdaten auf diesem Gerät löschen? Vorher bitte ein vollständiges JSON-Backup exportieren.'))return;
  if(!confirm('Letzte Bestätigung: Nicht exportierte Änderungen gehen verloren. Lokale Wissensdaten löschen?'))return;
  try{await pwaDeleteBundle();location.reload()}catch(e){toast('Löschen fehlgeschlagen: '+e.message)}
 };
 const installBtn=document.getElementById('pwaInstall');
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();pwaDeferredInstall=e;installBtn.hidden=false;});
 installBtn.onclick=async()=>{if(!pwaDeferredInstall)return;const e=pwaDeferredInstall;pwaDeferredInstall=null;installBtn.hidden=true;await e.prompt();};
 window.addEventListener('appinstalled',()=>{pwaDeferredInstall=null;installBtn.hidden=true});
 if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')){
  navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(e=>console.warn('Offline-Service-Worker nicht registriert',e));
 }
}
async function pwaStart(){
 pwaSetup();wire();
 try{let existing=await pwaReadBundle();if(existing){validateViewerBundleStrict(existing);prepare(existing);pwaShowWelcome(false)}else{pwaShowWelcome(true)}}
 catch(e){console.warn('Gespeicherter Wissensbestand nicht ladbar',e);pwaShowWelcome(true);const info=document.getElementById('pwaLocalStatus');if(info)info.textContent='Lokale Daten konnten nicht geladen werden. Bitte Original-JSON erneut importieren.'}
}

const S={view:'faq',faq:null,node:null,tab:'simple',query:'',category:'all',scope:'all',proof:'all',sort:'id',exact:false,advanced:[],join:'all',graphRelation:'all',graphFocus:false,graphMode:'visual',graphScope:'all',mobilePanel:'list',filtered:[],visibleNodes:[],remarks:[],searchError:''};
const nodeId=n=>String(n?.id??''),edgeId=e=>String(e?.id??'');
function toast(t){let x=$('toast');x.textContent=t;x.classList.remove('hidden');clearTimeout(toast._t);toast._t=setTimeout(()=>x.classList.add('hidden'),4000)}
function bundleError(m){$('importError').classList.remove('hidden');$('importError').textContent=m;toast(m)}
function validate(b){if(!b||b.viewerBundleSchema!=='pmi.wissensnavigator.bundle.v1')throw Error('Unbekanntes Viewer-Bundle-Schema. Erwartet pmi.wissensnavigator.bundle.v1.');let w=b.workingSource,i=b.faqIndex,q=b.qaRegistry,ev=b.evidenceRegistry;
if(!w||w.meta?.schema!=='vv4vis.v2'||!Array.isArray(w.payload?.structure?.nodes)||!Array.isArray(w.payload?.structure?.edges)||typeof w.payload?.io?.annotations!=='object')throw Error('VV4 Working Source fehlt oder Schema ist nicht gültig.');
if(!i||!Array.isArray(i.entries)||!i.workingSourceDocumentKey)throw Error('FAQ-Index fehlt oder ist ungültig.');
if(w.meta.documentRef?.key!==i.workingSourceDocumentKey)throw Error('Der DocumentKey der Working Source passt nicht zum FAQ-Index.');
let ns=new Set(),es=new Set();for(let n of w.payload.structure.nodes){if(!n.id||ns.has(n.id))throw Error('Knoten-ID doppelt/leer: '+n.id);ns.add(n.id)}
for(let e of w.payload.structure.edges){if(!e.id||es.has(e.id)||!ns.has(e.from)||!ns.has(e.to))throw Error('Ungültige Kante: '+e.id);es.add(e.id)}
let ids=new Set(),ann=w.payload.io.annotations;for(let f of i.entries){if(!f.faqId||ids.has(f.faqId))throw Error('FAQ-ID doppelt/leer: '+f.faqId);ids.add(f.faqId);
for(let name of ['primaryAnchor','technicalAnchor','reviewAnchor']){let a=f[name];if(!a||a.documentKey!==i.workingSourceDocumentKey||a.sectionRef!==f.faqId||!['node','edge'].includes(a.entityType)||!['user_docs','runbook','notes'].includes(a.field))throw Error('Anker inkonsistent '+f.faqId+' / '+name);
if(!(a.entityType==='node'?ns:es).has(a.entityId)||!ann[a.entityId])throw Error('Anker zeigt auf fehlendes Objekt '+f.faqId+' / '+a.entityId);
let section=getSection(ann[a.entityId][a.field],f.faqId);if(!section.ok)throw Error('Fehlender/doppelter FAQ-Abschnitt '+f.faqId+' / '+name+' ('+section.error+')');}
for(let e of f.relatedEntities??[]){if(!(e.entityType==='node'?ns:es).has(e.entityId))throw Error('Verknüpftes Objekt fehlt: '+e.entityId)}}
if(i.faqCount!==i.entries.length)throw Error('faqCount unterscheidet sich von Anzahl der FAQ-IDs');if(!Array.isArray(q?.items)||!Array.isArray(ev?.entries))throw Error('Qualitäts-/Belegregister fehlen.');return true;}
function validateWorkingSource(w){
 if(!w||typeof w!=='object'||Array.isArray(w)||w.meta?.schema!=='vv4vis.v2'||w.meta?.workingSource?.schemaVersion!=='vv4.annotation-working-source.v1'||w.meta?.workingSource?.reportPackage!==false)throw Error('Keine gültig gekennzeichnete VV4-Annotations-Working-Source (v1).');
 const key=w.meta.workingSource.documentKey;
 if(typeof key!=='string'||!key.trim()||w.meta.documentRef?.key!==key)throw Error('Working-Source-Identität und documentRef stimmen nicht überein.');
 const st=w.payload?.structure,anns0=w.payload?.io?.annotations;
 if(!Array.isArray(st?.nodes)||!Array.isArray(st?.edges)||!anns0||typeof anns0!=='object'||Array.isArray(anns0))throw Error('VV4-Struktur oder Annotationen fehlen.');
 const ids=new Set(),edges=new Set();
 for(const n of st.nodes){if(typeof n.id!=='string'||!n.id||ids.has(n.id))throw Error('Doppelte/fehlende Node-ID: '+n.id);ids.add(n.id);if(!n.meta?.templateRef?.key)throw Error('Template fehlt am Knoten: '+n.id)}
 for(const e of st.edges){if(typeof e.id!=='string'||!e.id||edges.has(e.id)||!ids.has(e.from)||!ids.has(e.to))throw Error('Kante fehlerhaft: '+e.id);edges.add(e.id);}
 for(const id of Object.keys(anns0)){if(!ids.has(id)&&!edges.has(id))throw Error('Verwaiste Annotation: '+id)}
 return {documentKey:key,nodes:ids.size,edges:edges.size,annotations:Object.keys(anns0).length};
}
function validateViewerBundleStrict(b){validate(b);const ws=validateWorkingSource(b.workingSource);if(b.faqIndex.workingSourceDocumentKey!==ws.documentKey)throw Error('FAQ-Index und VV4-Working-Source beziehen sich auf unterschiedliche Dokumente.');
 const invalid=[];for(const f of b.faqIndex.entries){for(const ref of f.evidenceRefs||[]){if(!b.evidenceRegistry.entries.some(x=>x.evidenceId===ref))invalid.push(f.faqId+': '+ref)}}
 if(invalid.length)throw Error('Nicht auflösbare Belegreferenzen: '+invalid.slice(0,3).join(', '));return ws;
}
function getSection(text,id){let lines=String(text??'').split(/\r?\n/),starts=[];for(let n=0;n<lines.length;n++)if(new RegExp('^###\\s+'+id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*(?:[–—-]|$)').test(lines[n]))starts.push(n);
if(starts.length!==1)return {ok:false,error:starts.length===0?'missing':'duplicate'};let s=starts[0],e=s+1;for(;e<lines.length;e++)if(/^###\s+FAQ-[A-Za-z0-9-]+\s*(?:[–—-]|$)/.test(lines[e]))break;return {ok:true,raw:lines.slice(s,e).join('\n').trim()};}
function prepare(b){validateViewerBundleStrict(b);bundle=b;let w=b.workingSource;anns=w.payload.io.annotations;nodeMap=new Map(w.payload.structure.nodes.map(n=>[n.id,n]));edgeMap=new Map(w.payload.structure.edges.map(e=>[e.id,e]));faqMap=new Map(b.faqIndex.entries.map(f=>[f.faqId,f]));qas=new Map(b.qaRegistry.items.map(q=>[q.faqId,q]));evidence=new Map(b.evidenceRegistry.entries.map(v=>[v.evidenceId,v]));derived=new Map();for(let f of faqMap.values()){
const section={};for(let [k,field] of [['simple','primaryAnchor'],['technical','technicalAnchor'],['review','reviewAnchor']]){let a=f[field];section[k]=getSection(anns[a.entityId][a.field],f.faqId).raw;}
const obj=[f.primaryAnchor.entityId,...(f.relatedEntities??[]).map(e=>e.entityId)].map(id=>anns[id]?.title||nodeMap.get(id)?.label||edgeMap.get(id)?.label||id);
const ev=f.evidenceRefs?.flatMap(ref=>{let x=evidence.get(ref);return x?.sourceFileNameMentions??[]})??[];
derived.set(f.faqId,{...section,objects:obj.join(' '),sources:ev,all:[f.faqId,f.question,section.simple,section.technical,section.review,obj.join(' '),ev.join(' ')].join(' \n ')})}
S.faq=[...faqMap.keys()][0];S.node=null;S.view='faq';S.tab='simple';S.query='';S.category='all';S.proof='all';S.scope='all';S.advanced=[];S.remarks=[];S.join='all';S.graphRelation='all';S.graphFocus=false;S.graphScope=mobile()? 'current':'all';S.mobilePanel='list';S.searchError='';if(network){network.destroy();network=null}
$('query').value='';$('category').value='all';$('proof').value='all';$('scope').value='all';$('sort').value='id';$('sourceTag').textContent=(b.manifest?.sourceZip||'ZIP 1824')+' · '+(b.manifest?.knowledgeVersion||'V005')+' Daten';$('schemaTag').textContent='Viewer V011 · Mobile First';$('loadedFile').textContent=b.manifest?.label||'Eingebettete Referenzdaten V005';$('importError').classList.add('hidden');renderAll();}
function parseQuery(input){const groups=[['']], raw=String(input||'');let cur=groups[0];let escape=false;for(let c of raw){if(escape){cur[cur.length-1]+=c;escape=false;continue}if(c==='\\'){escape=true;continue}if(c==='#'){cur=[''];groups.push(cur);continue}if(c==='|'){cur.push('');continue}cur[cur.length-1]+=c}if(escape)cur[cur.length-1]+='\\';return groups.map(g=>g.map(x=>x.trim()).filter(Boolean)).filter(g=>g.length>0)}
function normalized(t,ex){t=String(t??'').toLocaleLowerCase('de');return ex?t:t.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')}
function matchQuery(text){if(!S.query.trim())return true;let t=normalized(text,S.exact);return parseQuery(S.query).every(g=>g.some(q=>t.includes(normalized(q,S.exact))))}
function fieldVal(f,k){let d=derived.get(f.faqId);if(k==='id')return f.faqId;if(k==='title')return f.question;if(k==='user')return d.simple;if(k==='tech')return d.technical;if(k==='review')return d.review;if(k==='source')return d.sources.join(' ');if(k==='object')return d.objects;if(k==='category')return f.category;return d.all}
function facetMatch(f){if(S.category!=='all'&&f.category!==S.category)return false;if(S.proof==='openbrowser'&&qas.get(f.faqId)?.browser!=='NOT_TESTED')return false;if(S.proof==='opensql'&&qas.get(f.faqId)?.sql!=='NOT_TESTED')return false;if(S.proof==='openeditor'&&qas.get(f.faqId)?.editorImport!=='NOT_TESTED')return false;if(S.proof==='unclassified'&&qas.get(f.faqId)?.pmiCoverage&& !String(qas.get(f.faqId).pmiCoverage).includes('HISTORISCHE'))return false;if(S.proof==='reviewed'&&qas.get(f.faqId)?.userReviewed!==true)return false;
if(S.advanced.length){let bools=S.advanced.map(flt=>{let x=normalized(fieldVal(f,flt.field),flt.exact),val=normalized(flt.value,flt.exact);let ok=val?x.includes(val):true;return flt.not?!ok:ok});if(S.join==='all'?!bools.every(Boolean):!bools.some(Boolean))return false}
const text=fieldVal(f,S.scope);return matchQuery(text)}
function objectText(n,field){const a=anns[n.id]||{},labels=Array.isArray(a.labels)?a.labels.join(' '):'',meta=n.meta?.templateRef?.key||'';
 if(field==='id')return n.id;
 if(field==='title')return [n.label,a.title].join(' ');
 if(field==='user')return [a.summary,a.user_docs].join(' ');
 if(field==='tech')return [a.runbook,meta,n.id].join(' ');
 if(field==='review')return a.notes||'';
 if(field==='source')return [a.links||[],a.notes].join(' ');
 if(field==='object')return [n.id,n.label,a.title,meta].join(' ');
 return [n.id,n.label,a.title,meta,labels,a.summary,a.user_docs,a.runbook,a.notes,JSON.stringify(a.links||[])].join(' \n ');
}
function matchingObjects(){let permitted=null;
 if(S.category!=='all'||S.proof!=='all'){
  let fs=[...faqMap.values()].filter(f=>{
   if(S.category!=='all'&&f.category!==S.category)return false;
   if(S.proof==='openbrowser'&&qas.get(f.faqId)?.browser!=='NOT_TESTED')return false;
   if(S.proof==='opensql'&&qas.get(f.faqId)?.sql!=='NOT_TESTED')return false;
   if(S.proof==='openeditor'&&qas.get(f.faqId)?.editorImport!=='NOT_TESTED')return false;
   if(S.proof==='reviewed'&&qas.get(f.faqId)?.userReviewed!==true)return false;
   return true;
  });
  permitted=new Set(fs.flatMap(f=>[f.primaryAnchor.entityId,...(f.relatedEntities||[]).map(e=>e.entityId)]));
 }
 return [...nodeMap.values()].filter(n=>{
  if(permitted&&!permitted.has(n.id))return false;
  if(S.query.trim()){
   const corpus=normalized(objectText(n,S.scope),S.exact);
   if(!parseQuery(S.query).every(g=>g.some(q=>corpus.includes(normalized(q,S.exact)))))return false;
  }
  if(S.advanced.length){let results=S.advanced.map(f=>{let x=normalized(objectText(n,f.field),f.exact),v=normalized(f.value,f.exact);let found=v?x.includes(v):true;return f.not?!found:found});
   if(!(S.join==='all'?results.every(Boolean):results.some(Boolean)))return false;
  }
  return true;
 }).sort((a,b)=>S.sort==='title'?(a.label||'').localeCompare(b.label||'','de'):(a.id||'').localeCompare(b.id||'','de'));
}
function matchedFaqs(){return [...faqMap.values()].filter(facetMatch).sort((a,b)=>{if(S.sort==='title')return a.question.localeCompare(b.question,'de');if(S.sort==='category')return a.category.localeCompare(b.category,'de')||a.faqId.localeCompare(b.faqId);return a.faqId.localeCompare(b.faqId)})}
function formatInline(t){let text=esc(t);text=text.replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/(?<!\*)\*([^*]+)\*(?!\*)/g,'<em>$1</em>');return text}
function formatMarkdown(src){let lines=String(src||'').replace(/\r/g,'').split('\n'),out=[],paragraph=[],lst=null,inCode=false,code=[];
const flushP=()=>{if(paragraph.length){out.push('<p>'+formatInline(paragraph.join(' '))+'</p>');paragraph=[]}},flushL=()=>{if(lst){out.push('</'+lst+'>');lst=null}};
for(let i=0;i<lines.length;i++){let l=lines[i],m;if(/^\s*```/.test(l)){flushP();flushL();if(inCode){out.push('<pre><code>'+esc(code.join('\n'))+'</code></pre>');code=[];inCode=false}else inCode=true;continue}if(inCode){code.push(l);continue}if(!l.trim()){flushP();flushL();continue}if(/^\s*\|/.test(l)&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])){flushP();flushL();let tbl=[l];i++;while(i+1<lines.length&&/^\s*\|/.test(lines[i+1]))tbl.push(lines[++i]);let cells=x=>x.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(y=>y.trim());out.push('<table><thead><tr>'+cells(tbl.shift()).map(c=>'<th>'+formatInline(c)+'</th>').join('')+'</tr></thead><tbody>');for(let r of tbl)out.push('<tr>'+cells(r).map(c=>'<td>'+formatInline(c)+'</td>').join('')+'</tr>');out.push('</tbody></table>');continue}
if((m=/^(#{1,5})\s+(.+)$/.exec(l))){flushP();flushL();let size=Math.min(5,m[1].length+1);out.push('<h'+size+'>'+formatInline(m[2])+'</h'+size+'>');continue}if(/^\s*(?:---+|___+)\s*$/.test(l)){flushP();flushL();out.push('<hr>');continue}if((m=/^\s*>\s*(.*)/.exec(l))){flushP();flushL();out.push('<blockquote>'+formatInline(m[1])+'</blockquote>');continue}if((m=/^\s*(?:[-*]|\d+\.)\s+(.+)/.exec(l))){flushP();let typ=/^\s*\d+\./.test(l)?'ol':'ul';if(lst!==typ){flushL();out.push('<'+typ+'>');lst=typ}out.push('<li>'+formatInline(m[1])+'</li>');continue}flushL();paragraph.push(l.trim());}
flushP();flushL();if(inCode)out.push('<pre><code>'+esc(code.join('\n'))+'</code></pre>');return out.join('\n')}
function detailTab(tab){S.tab=tab;renderAll()}
function chooseFaq(id){if(!faqMap.has(id))return;S.faq=id;S.node=null;S.tab='simple';S.view='faq';S.mobilePanel='detail';renderAll();}
function chooseNode(id){if(!nodeMap.has(id)&&!edgeMap.has(id))return;S.node=id;S.view='objects';S.tab='all';S.mobilePanel='detail';renderAll()}
function mobile(){return !!window.matchMedia&&window.matchMedia('(max-width:719px)').matches}
function chooseView(v){S.view=v;S.mobilePanel=v==='graph'?'detail':'list';if(v==='graph'){S.graphScope=mobile()?'current':'all';S.graphFocus=S.graphScope!=='all';}renderAll()}
function renderNav(){document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===S.view));$('navFaqCount').textContent=faqMap.size;$('navObjectsCount').textContent=nodeMap.size;$('navGraphCount').textContent=edgeMap.size;}
function renderLeft(){let fs=matchedFaqs();S.filtered=fs;let matchCount=fs.length;$('matchCount').textContent=matchCount+' / '+faqMap.size+' Fragen';$('resetAll').disabled=!(S.query||S.category!=='all'||S.proof!=='all'||S.advanced.length);let items=$('resultList');items.replaceChildren();let title=$('leftTitle'),intro=$('leftIntro');if(S.view==='objects'){title.textContent='Wissensobjekte';intro.textContent=`${nodeMap.size} Knoten, ${edgeMap.size} Beziehungen · Objektliste`;let nodes=matchingObjects();$('matchCount').textContent=nodes.length+' / '+nodeMap.size+' Objekte';for(let n of nodes){let el=document.createElement('button');el.type='button';el.className='result'+(S.node===n.id?' selected':'');el.innerHTML='<div class="id">'+esc(n.id)+'</div><h4>'+esc(n.label)+'</h4><div class="summary">'+esc(anns[n.id]?.summary||'Keine Kurzbeschreibung')+'</div><div class="badges"><span class="chip">'+esc(n.meta?.templateRef?.key||'ohne Template')+'</span></div>';el.onclick=()=>chooseNode(n.id);items.appendChild(el)}if(!nodes.length)items.innerHTML='<div class="empty">Keine Objekte im Such-/Filterkontext</div>';return}
if(S.view==='graph'){title.textContent='Verknüpfte Fragen';intro.textContent='Auswahl fokussiert den Wissensgraph';}
else if(S.view==='quality'){title.textContent='Prüf- und Qualitätsfälle';intro.textContent='Ungeklärte Nachweise und Freigabestatus';}
else if(S.view==='sources'){title.textContent='Quellenbasierte FAQs';intro.textContent='Primärquelle PMI, Arbeitsdateien ergänzend';}
else {title.textContent='FAQ-Katalog';intro.textContent='Suchen, filtern und Fragen auswählen';}
for(let f of fs){let el=document.createElement('button');el.type='button';el.className='result'+(S.faq===f.faqId?' selected':'');el.innerHTML='<div class="row end"><span class="id">'+esc(f.faqId)+'</span><span class="chip">'+esc(f.category)+'</span></div><h4>'+esc(f.question)+'</h4><div class="summary">'+esc(anns[f.primaryAnchor.entityId]?.summary||'')+'</div><div class="badges"><span class="chip warn">Nicht freigegeben</span><span class="chip">PMI: unklassifiziert</span></div>';el.onclick=()=>{S.faq=f.faqId;S.node=null;S.tab='simple';if(S.view==='graph'){S.graphScope='current';S.graphFocus=true;}S.mobilePanel='detail';renderAll()};items.appendChild(el)}if(!fs.length)items.innerHTML='<div class="empty"><b>Keine Treffer</b>Ändere deine Suchbedingungen oder setze die Filter zurück.</div>';
}
function detailHead(title,id,caption){return '<div class="detail-top"><div class="eyebrow">'+esc(id)+'</div><h1>'+esc(title)+'</h1><div class="caption">'+esc(caption)+'</div></div>'}
function detailTabs(tabs){return '<div class="tabrow">'+tabs.map(t=>'<button type="button" class="tab '+(S.tab===t[0]?'active':'')+'" data-tab="'+t[0]+'">'+esc(t[1])+'</button>').join('')+'</div>'}
function renderDetail(){let mid=$('detail');mid.classList.remove('hidden');let f=faqMap.get(S.faq);let body='';if(S.view==='graph'){mid.innerHTML=detailHead('Programmwelt und Wissensbeziehungen','INTERAKTIVER GRAPH','Wissensgraph aus dem geladenen Datenpaket · Knoten wählen, Details öffnen')+'<div class="graph-pane"><div class="graph-tools"><label for="relation">Relation:</label><select id="relation"><option value="all">Alle Beziehungen</option></select><label for="graphScope">Fokus:</label><select id="graphScope" aria-label="Graphumfang"><option value="current">Aktuelle FAQ</option><option value="matches">Suchtreffer</option><option value="all">Alle Knoten</option></select><label class="row graph-focus-legacy"><input type="checkbox" id="graphFocus"> Fokus aktiv</label><button id="graphFit" class="btn tiny">Alles anzeigen</button><button id="graphList" class="btn tiny">Listenansicht</button></div><div id="graphCanvas" class="graph-canvas" role="img" aria-label="Wissensnetzwerk mit klickbaren Knoten"></div><div id="graphListFallback" class="graph-fallback hidden"></div></div>';let relation=$('relation');let types=[...new Set([...edgeMap.values()].map(e=>e.relationType))].sort();relation.innerHTML+='<option value="documents">Nur Dokumentationskanten</option>';for(let t of types){if(t==='documents')continue;let o=document.createElement('option');o.value=t;o.textContent=t;relation.appendChild(o)}relation.value=S.graphRelation;$('graphFocus').checked=S.graphScope!=='all';$('graphScope').value=S.graphScope;relation.onchange=()=>{S.graphRelation=relation.value;renderGraph()};$('graphScope').onchange=()=>{S.graphScope=$('graphScope').value;S.graphFocus=S.graphScope!=='all';renderGraph()};$('graphFocus').onchange=()=>{S.graphScope=$('graphFocus').checked?'matches':'all';S.graphFocus=S.graphScope!=='all';$('graphScope').value=S.graphScope;renderGraph()};$('graphFit').onclick=()=>network?.fit({animation:true});$('graphList').onclick=()=>{S.graphMode=S.graphMode==='visual'?'list':'visual';renderGraph()};setTimeout(renderGraph,0);return}
if(S.view==='objects'&&edgeMap.has(S.node)){
 const e=edgeMap.get(S.node),a=anns[e.id]||{};
 mid.innerHTML=detailHead(a.title||e.label||e.relationType,'BEZIEHUNG · '+e.id,'Dokumentierte Graphkante · '+e.relationType)+
 '<div class="scroll"><div class="article"><div class="callout">'+(e.relationType==='documents'?'Dokumentationsbezug: kein Nachweis eines Programmaufrufs.':'Laufzeit- oder Fachbeziehung aus dem vorhandenen Programmwelt-Modell; keine neue Browserprüfung.')+'</div>'+
 '<section><div class="section-kicker">Ausgangspunkt</div><button class="result" data-node="'+esc(e.from)+'">'+esc(nodeMap.get(e.from)?.label||e.from)+' <small>('+esc(e.from)+')</small></button></section>'+
 '<section><div class="section-kicker">Ziel</div><button class="result" data-node="'+esc(e.to)+'">'+esc(nodeMap.get(e.to)?.label||e.to)+' <small>('+esc(e.to)+')</small></button></section>'+
 ['summary','user_docs','runbook','notes'].filter(k=>a[k]).map(k=>'<section><div class="section-kicker">'+k+'</div><div class="markdown">'+formatMarkdown(a[k])+'</div></section>').join('')+
 '<section><div class="section-kicker">Relationstyp</div><code>'+esc(e.relationType)+'</code></section></div></div>';wireDetail();return;
 }
if(S.view==='objects'){let n=nodeMap.get(S.node)||nodeMap.get(f?.primaryAnchor?.entityId)||[...nodeMap.values()][0];if(!n)return;S.node=n.id;let a=anns[n.id]||{};let related=[...faqMap.values()].filter(f=>f.primaryAnchor.entityId===n.id||(f.relatedEntities??[]).some(e=>e.entityId===n.id));mid.innerHTML=detailHead(a.title||n.label,'OBJEKT · '+n.id,esc(n.meta?.templateRef?.key||'Template nicht zugeordnet'))+detailTabs([['all','Vollständige Annotation'],['connections','Beziehungen'],['related','FAQs']]);if(!['all','connections','related'].includes(S.tab))S.tab='all';let items='';if(S.tab==='all')items=['summary','user_docs','runbook','notes'].map(key=>'<section><div class="section-kicker">'+key+'</div><div class="markdown">'+formatMarkdown(a[key]||'Nicht vorhanden')+'</div></section>').join('<hr>')+'<div class="section-kicker">Weitere Felder</div><div class="markdown"><p>Labels: '+esc((a.labels||[]).join(', ')||'–')+'</p><p>Status: '+esc(a.status||'nicht gesetzt')+'</p><p>Links: '+esc((a.links||[]).join(' · ')||'–')+'</p></div>';
if(S.tab==='connections'){let edges=[...edgeMap.values()].filter(e=>e.from===n.id||e.to===n.id);items='<div class="section-kicker">'+edges.length+' direkte Beziehungen</div>'+edges.map(e=>'<div class="quality-row"><strong>'+esc(e.relationType)+' · '+esc(e.label||e.id)+'</strong><small>'+esc(nodeMap.get(e.from)?.label||e.from)+' → '+esc(nodeMap.get(e.to)?.label||e.to)+'</small><div class="badges"><span class="chip '+(e.relationType==='documents'?'green':'')+'">'+(e.relationType==='documents'?'Dokumentationsbezug':'Programmmodell')+'</span></div></div>').join('')}
if(S.tab==='related')items='<div class="section-kicker">Zugehörige FAQ-Fragen</div>'+related.map(f=>'<button class="result" data-faq="'+esc(f.faqId)+'"><span class="id">'+esc(f.faqId)+'</span><h4>'+esc(f.question)+'</h4></button>').join('');mid.innerHTML+='<div class="scroll"><div class="article">'+items+'</div></div>';wireDetail();return}
if(!f){mid.innerHTML='<div class="empty">Kein FAQ-Datensatz ausgewählt</div>';return}
const d=derived.get(f.faqId),q=qas.get(f.faqId)||{},ev=(f.evidenceRefs||[]).map(id=>evidence.get(id)).filter(Boolean);
let caption='Datenstand V005 · Redaktioneller Entwurf · Keine Nutzer- oder Produktivfreigabe';
if(S.view==='quality'){mid.innerHTML=detailHead(f.question,'PRÜFUNG · '+f.faqId,caption)+detailTabs([['simple','Prüfbericht'],['review','Detailprüfung'],['sources','Quellen']]);if(!['simple','review','sources'].includes(S.tab))S.tab='simple';body=S.tab==='simple'?'<div class="callout">PMI-Abdeckung ist nicht als abschließende Qualitätsstufe klassifiziert. Eine historische qualitative Bewertung ist keine neue Abnahme.</div><div class="stats"><div class="stat"><b>offen</b><small>Browser-Nachweis</small></div><div class="stat"><b>offen</b><small>SQL-Live-Nachweis</small></div><div class="stat"><b>offen</b><small>Editor-Roundtrip</small></div><div class="stat"><b>offen</b><small>Nutzerfreigabe</small></div></div><div class="quality-row"><strong>PMI-Abdeckung</strong><small>'+esc(q.pmiCoverage||'Nicht klassifiziert')+'</small></div><div class="quality-row"><strong>Redaktioneller Übertrag</strong><small>'+esc(q.transfer||'unbekannt')+'</small></div><button class="btn" id="bookmarkReview">Prüfpunkt für Export vormerken</button>':S.tab==='review'?'<div class="markdown">'+formatMarkdown(d.review)+'</div>':sourcesDetail(f,ev);
}else if(S.view==='sources'){mid.innerHTML=detailHead(f.question,'QUELLEN · '+f.faqId,caption)+detailTabs([['sources','Belegübersicht'],['technical','Technischer Nachweis'],['review','Beweisgrenzen']]);if(!['sources','technical','review'].includes(S.tab))S.tab='sources';body=S.tab==='sources'?sourcesDetail(f,ev):'<div class="markdown">'+formatMarkdown(S.tab==='review'?d.review:d.technical)+'</div>';
}else{mid.innerHTML=detailHead(f.question,'FAQ · '+f.faqId,caption)+detailTabs([['simple','Einfach erklärt'],['technical','Für Fachleute'],['review','Prüfung'],['sources','Quellen']]);if(!['simple','technical','review','sources'].includes(S.tab))S.tab='simple';body=S.tab==='sources'?sourcesDetail(f,ev):'<div class="callout">Wissensstand aus der statischen Analyse. Keine Freigabe oder vollständige Live-/SQL-/Browserabnahme.</div><div class="markdown">'+formatMarkdown(d[S.tab])+'</div>'}
mid.innerHTML+='<div class="scroll"><article class="article">'+body+'</article></div>';wireDetail();}
function sourcesDetail(f,ev){return '<div class="callout info">PMI- und Codepfade sind Referenzen im Originalarchiv; sie sind nicht automatisch über lokale URLs erreichbar. Belege stammen aus dem Analysebestand V005.</div><div class="section-kicker">FAQ-Datei</div><div class="source-line mono">'+esc(f.sourceFaqFile)+'</div><div class="section-kicker">PMI-/Arbeitsdateien aus dem Belegregister</div>'+(ev.length?ev.flatMap(x=>x.sourceFileNameMentions||[]).map(p=>'<div class="source-line mono">'+esc(p)+'</div>').join(''):'<p>Keine strukturierten Dateibelege vorhanden.</p>')+'<p class="counter">Quelle: '+esc((f.evidenceRefs||[]).join(', ')||'keine')+' · Nachweisstatus: Dateinamen indiziert; keine neue Liveprüfung.</p>'}
function wireDetail(){document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>detailTab(b.dataset.tab));document.querySelectorAll('[data-faq]').forEach(b=>b.onclick=()=>chooseFaq(b.dataset.faq));document.querySelectorAll('#detail [data-node]').forEach(b=>b.onclick=()=>chooseNode(b.dataset.node));$('bookmarkReview')?.addEventListener('click',()=>{let key=S.faq;if(!S.remarks.includes(key))S.remarks.push(key);toast('Prüfpunkt '+key+' vorgemerkt – kein Inhalt verändert.')})}
function renderAside(){const el=$('asideBody'),f=faqMap.get(S.faq);if(S.view==='graph'){el.innerHTML='<div class="aside-card"><h3>Graph-Legende</h3><p><span class="chip green">Türkis</span> Fragenbezug / ausgewähltes Objekt</p><p><span class="chip">Hellgrau</span> Kontextknoten</p><p><span class="chip green">Gestrichelt</span> Dokumentationskante</p><p>Die 13 neuen Dokumentationskanten bedeuten nicht automatisch einen technischen Programmaufruf.</p></div><div class="aside-card"><h3>Bedienung</h3><p>Knoten anklicken, ziehen und zoomen. Mit „Nur Treffer und Kontext“ lässt sich das Netz auf die gefundenen FAQs eingrenzen.</p></div>';return}
if(S.view==='objects'&&edgeMap.has(S.node)){
 let e=edgeMap.get(S.node);el.innerHTML='<div class="aside-card"><h3>Kanteninformation</h3><p class="mono">'+esc(e.id)+'</p><p>Relation: '+esc(e.relationType)+'</p><p>'+esc(e.from)+' → '+esc(e.to)+'</p><p>Annotation: '+(anns[e.id]?'vorhanden':'nicht vorhanden')+'</p></div>';return;
 }
if(S.view==='objects'){let a=anns[S.node];let n=nodeMap.get(S.node);if(!a||!n){el.innerHTML='';return}let related=[...faqMap.values()].filter(f=>f.primaryAnchor.entityId===S.node||(f.relatedEntities||[]).some(x=>x.entityId===S.node));el.innerHTML='<div class="aside-card"><h3>Objektdaten</h3><div class="mono">'+esc(S.node)+'</div><p>'+esc(n.meta?.templateRef?.key||'Ohne Template')+'</p><p>Annotation: '+(a?'vorhanden':'fehlt')+'</p></div><div class="aside-card"><h3>Zugehörige FAQs · '+related.length+'</h3><ul class="aside-list">'+related.map(f=>'<li><button class="linklike" data-faq="'+esc(f.faqId)+'">'+esc(f.faqId)+' · '+esc(f.question)+'</button></li>').join('')+'</ul></div>';wireAside();return}
if(!f){el.innerHTML='';return}const qa=qas.get(f.faqId)||{},ev=(f.evidenceRefs||[]).map(id=>evidence.get(id)).filter(Boolean);let refs=[f.primaryAnchor.entityId,...(f.relatedEntities||[]).map(r=>r.entityId)];el.innerHTML='<div class="aside-card"><h3>Belegstatus</h3><span class="chip warn">PMI-Abdeckung nicht klassifiziert</span><p><b>Code-/Quellenabgleich:</b> historischer Analyseentwurf</p><p><b>Browser:</b> '+esc(qa.browser==='NOT_TESTED'?'offen':qa.browser||'nicht erfasst')+'</p><p><b>SQL live:</b> '+esc(qa.sql==='NOT_TESTED'?'offen':qa.sql||'nicht erfasst')+'</p><p><b>Editor-Import:</b> '+esc(qa.editorImport==='NOT_TESTED'?'offen':qa.editorImport||'nicht erfasst')+'</p><p><b>Nutzerfreigabe:</b> '+(qa.userReviewed?'ja':'nein')+'</p><button class="btn tiny" data-tab="review">Beweisgrenzen anzeigen</button></div><div class="aside-card"><h3>Verknüpfte Wissensobjekte</h3><ul class="aside-list">'+[...new Set(refs)].map(id=>'<li><button class="linklike mono" data-node="'+esc(id)+'">'+esc(id)+'</button><div class="counter">'+esc(anns[id]?.title||nodeMap.get(id)?.label||'')+'</div></li>').join('')+'</ul></div><div class="aside-card"><h3>Quellenregister · '+ev.reduce((n,x)=>n+(x.sourceFileNameMentions||[]).length,0)+'</h3><p>PMI primär, Arbeitsdateien bei Bedarf. Originalpfade sind bewusst keine direkten Links.</p><button class="btn tiny" data-tab="sources">Quellen aufrufen</button></div>';
wireAside();}
function wireAside(){document.querySelectorAll('#asideBody [data-tab]').forEach(b=>b.onclick=()=>detailTab(b.dataset.tab));document.querySelectorAll('#asideBody [data-faq]').forEach(b=>b.onclick=()=>chooseFaq(b.dataset.faq));document.querySelectorAll('#asideBody [data-node]').forEach(b=>b.onclick=()=>chooseNode(b.dataset.node))}
function graphNodeColor(n,highlight,dim){return highlight?'#0e9e9a':dim?'#e5eaed':n.id.startsWith('doc_')?'#d4e5ef':'#b8d5e1'}
function renderGraph(){if(S.view!=='graph')return;const canvas=$('graphCanvas'),fallback=$('graphListFallback');if(!canvas||!fallback)return;const graphFaqs=S.graphScope==='current'?[faqMap.get(S.faq)].filter(Boolean):matchedFaqs();const selectedNodes=new Set(graphFaqs.flatMap(f=>[f.primaryAnchor.entityId,...(f.relatedEntities||[]).map(e=>e.entityId)]));const selectedEdgeSet=new Set();let edges=[...edgeMap.values()].filter(e=>S.graphRelation==='all'||e.relationType===S.graphRelation);let visible=new Set(nodeMap.keys());if(S.graphScope!=='all'){visible=new Set(selectedNodes);for(let e of edges)if(selectedNodes.has(e.from)||selectedNodes.has(e.to)){visible.add(e.from);visible.add(e.to)}}edges=edges.filter(e=>visible.has(e.from)&&visible.has(e.to));let nodes=[...nodeMap.values()].filter(n=>visible.has(n.id));let dimMode=S.graphScope!=='all'||S.query||S.category!=='all'||S.proof!=='all'||S.advanced.length;
if(network){network.destroy();network=null}fallback.innerHTML='';if(S.graphMode==='list'||typeof vis==='undefined'||typeof vis.Network!=='function'){canvas.classList.add('hidden');fallback.classList.remove('hidden');$('graphList').textContent='Graph anzeigen';fallback.innerHTML='<div class="pad"><b>Graph als Liste · '+nodes.length+' Knoten / '+edges.length+' Kanten</b></div>'+nodes.map(n=>'<button class="result" data-node="'+esc(n.id)+'"><span class="id">'+esc(n.id)+'</span><h4>'+esc(n.label)+'</h4><span class="chip">'+esc(n.meta?.templateRef?.key||'Objekt')+'</span></button>').join('');fallback.querySelectorAll('[data-node]').forEach(b=>b.onclick=()=>chooseNode(b.dataset.node));return}
canvas.classList.remove('hidden');fallback.classList.add('hidden');$('graphList').textContent='Graph als Liste';let vnodes=nodes.map(n=>({id:n.id,label:n.label,title:esc((anns[n.id]?.title||n.label)+'\n'+n.id),shape:'box',borderWidth:selectedNodes.has(n.id)?2:1,font:{color:dimMode&&!selectedNodes.has(n.id)?'#84949d':'#254251',size:12,face:'Arial'},color:{background:graphNodeColor(n,selectedNodes.has(n.id),dimMode&&!selectedNodes.has(n.id)),border:selectedNodes.has(n.id)?'#087e86':'#9dbac6',highlight:{background:'#ffdfaa',border:'#e0a34a'}},margin:8,shadow:false}));let vedges=edges.map(e=>({id:e.id,from:e.from,to:e.to,label:'',title:esc(e.relationType+': '+(e.label||'')),arrows:'to',dashes:e.relationType==='documents',width:e.relationType==='documents'?1.8:1.1,color:{color:e.relationType==='documents'?'#087e86':'#b6c4cb',opacity:.8}}));
network=new vis.Network(canvas,{nodes:new vis.DataSet(vnodes),edges:new vis.DataSet(vedges)},{autoResize:true,layout:{improvedLayout:true},physics:{enabled:true,solver:'barnesHut',barnesHut:{gravitationalConstant:-2400,centralGravity:.1,springLength:130,springConstant:.018,damping:.35},stabilization:{iterations:160}},interaction:{hover:!mobile(),navigationButtons:!mobile(),keyboard:!mobile()},nodes:{shape:'box'},edges:{smooth:{enabled:true,type:'dynamic'}}});network.once('stabilized',()=>{if(!network)return;network.setOptions({physics:{enabled:false}});if(mobile()&&S.graphScope==='current'){let center=faqMap.get(S.faq)?.primaryAnchor?.entityId;if(center&&visible.has(center))network.focus(center,{scale:1.0,animation:{duration:360,easingFunction:'easeInOutQuad'}})}});network.on('click',p=>{if(p.nodes.length){S.node=p.nodes[0];S.tab='all';S.view='objects';renderAll()}else if(p.edges.length){chooseNode(p.edges[0])}});}
function renderFilters(){let box=$('advancedRows');box.innerHTML='';S.advanced.forEach((a,i)=>{let row=document.createElement('div');row.className='filtergroup';row.innerHTML='<div class="row end"><span class="filter-title">Bedingung '+(i+1)+'</span><button class="btn tiny" data-del="'+i+'" type="button">Entfernen</button></div><div class="filteritem"><select data-idx="'+i+'" data-prop="field"><option value="all">Gesamter Inhalt</option><option value="title">Frage</option><option value="id">FAQ-ID</option><option value="user">Erklärung</option><option value="tech">Technik</option><option value="review">Prüfung</option><option value="object">Objekte</option><option value="source">Quellen</option></select><select data-idx="'+i+'" data-prop="not"><option value="0">enthält</option><option value="1">enthält nicht</option></select><button class="btn tiny" disabled>⊙</button><input data-idx="'+i+'" data-prop="value" placeholder="Suchwert" value="'+esc(a.value)+'"></div>';box.appendChild(row);row.querySelector('[data-prop="field"]').value=a.field;row.querySelector('[data-prop="not"]').value=a.not?'1':'0'});box.querySelectorAll('[data-del]').forEach(x=>x.onclick=()=>{S.advanced.splice(+x.dataset.del,1);renderAll()});box.querySelectorAll('[data-prop]').forEach(x=>x.addEventListener(x.tagName==='INPUT'?'input':'change',()=>{let v=S.advanced[+x.dataset.idx];if(x.dataset.prop==='not')v.not=x.value==='1';else v[x.dataset.prop]=x.value;renderAll(false)}));$('advancedJoin').value=S.join;}
function mobileToolbar(){const mid=$('detail');mid.querySelectorAll('.mobile-detailbar').forEach(e=>e.remove());mid.querySelectorAll('.mobile-read-footer').forEach(e=>e.remove());
if(S.view!=='graph'){
 const bar=document.createElement('div');bar.className='mobile-detailbar';
 const back=document.createElement('button');back.className='mobile-back';back.type='button';back.textContent='← Zurück';back.onclick=()=>{S.mobilePanel='list';renderAll();};bar.appendChild(back);
 if(S.view==='faq' || S.view==='quality' || S.view==='sources'){
   const f=faqMap.get(S.faq);const index=matchedFaqs().findIndex(x=>x.faqId===S.faq);const span=document.createElement('span');span.className='mobile-position';span.textContent=index>=0?(index+1)+' / '+matchedFaqs().length:'FAQ';bar.appendChild(span);
 }
 const focus=document.createElement('button');focus.className='mobile-context';focus.type='button';focus.textContent='◎ Graph';focus.onclick=()=>{S.view='graph';S.graphScope='current';S.graphFocus=true;S.mobilePanel='detail';renderAll()};bar.appendChild(focus);mid.prepend(bar);
 if(S.view==='faq'){
 const article=mid.querySelector('.article');if(article){const fs=matchedFaqs(),index=fs.findIndex(f=>f.faqId===S.faq);const footer=document.createElement('div');footer.className='mobile-read-footer';
 for(const [label,idx] of [['← Vorherige',index-1],['Nächste →',index+1]]){const btn=document.createElement('button');btn.type='button';btn.textContent=label;btn.disabled=idx<0||idx>=fs.length;btn.onclick=()=>{if(idx>=0&&idx<fs.length){S.faq=fs[idx].faqId;S.tab='simple';S.mobilePanel='detail';renderAll()}};footer.appendChild(btn)}article.appendChild(footer)
 }
 }
 }
}
function mobileLayout(){document.body.dataset.mobilePanel=S.view==='graph'?'detail':S.mobilePanel;}
function renderAll(doFilters=true){if(!bundle)return;renderNav();renderLeft();renderDetail();renderAside();mobileToolbar();mobileLayout();if(doFilters)renderFilters();$('statusInfo').textContent=`${faqMap.size} FAQs · ${nodeMap.size} Knoten · ${edgeMap.size} Kanten · ${Object.keys(anns).length} Annotationen`;$('statusResult').textContent=S.filtered.length+' Treffer';}
function textDownload(content,name,mime){let blob=new Blob([content],{type:mime||'text/plain;charset=utf-8'}),u=URL.createObjectURL(blob);let a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000)}
function exportReview(){const rows=S.remarks.map(id=>({faqId:id,reviewStatus:'zur Prüfung vorgemerkt',notes:'',sourceBundle:bundle.manifest?.label||'Unbekannt'}));textDownload(JSON.stringify({schema:'pmi.viewer.local-review-tasks.v1',generatedAt:new Date().toISOString(),items:rows},null,2),'PMI_VIEWER_PRUEFPUNKTE.json','application/json;charset=utf-8');toast(rows.length+' Prüfpunkte als separate JSON-Datei exportiert. Working Source unverändert.')}
function exportWorkingSource(){
 const w=bundle.workingSource,info=validateWorkingSource(w);textDownload(JSON.stringify(w,null,2),'VV4_WORKING_SOURCE_'+info.documentKey+'.json','application/json;charset=utf-8');
 toast('VV4 Working Source exportiert: nur Entwurf, kein Editor-Import oder Live-Speichern freigegeben.');
}
function exportIntegrityAudit(){
 const check=validateViewerBundleStrict(bundle);
 const questions=[...faqMap.values()].map(f=>({faqId:f.faqId,primaryEntity:f.primaryAnchor.entityId,relatedEntities:(f.relatedEntities||[]).map(x=>x.entityId),evidenceRefs:f.evidenceRefs||[],quality:qas.get(f.faqId)||null}));
 const result={schema:'pmi.viewer.static-validation.v1',viewer:'V012',createdAt:new Date().toISOString(),status:bundle.manifest?.editorSync?'STATIC_AND_USER_EDITOR_ROUNDTRIP_NO_SQL':'STATIC_ONLY_NO_EDITOR_TEST',workingSource:check,faqCount:questions.length,faq:questions,checks:{VV4_ANNOTATION_WORKING_SOURCE_MARKER:'PASS',NODE_EDGE_REFERENCES:'PASS',FAQ_ANNOTATION_SECTIONS:'PASS',EVIDENCE_REFERENCES:'PASS',EDITOR_IMPORT:bundle.manifest?.editorSync?'USER_COMPLETED_AND_STRUCTURALLY_COMPARED_V010':'NOT_TESTED',SQL_READBACK:'NOT_TESTED',USER_VISUAL_APPROVAL:'NOT_TESTED'}};
 textDownload(JSON.stringify(result,null,2),'PMI_VIEWER_STATIC_AUDIT_V011.json','application/json;charset=utf-8');toast('Statischer Prüfnachweis exportiert; keine Produktivabnahme.');
}
function syncReportMarkup(r,name){
 const label=r.status==='READY'?'Struktur vollständig – zur Übernahme bereit':r.status==='REVIEW_REQUIRED'?'Änderungen gefunden – fachliche Sichtung erforderlich':'Übernahme gesperrt';
 const badges='<div class="sync-metrics"><div><b>'+esc(r.faqCount)+'</b><small>FAQs</small></div><div><b>'+esc(r.anchorsValid)+'/'+esc(r.anchorsChecked)+'</b><small>gültige Anker</small></div><div><b>'+esc(r.countsAfter?.nodes??'?')+'</b><small>Knoten</small></div><div><b>'+esc(r.countsAfter?.edges??'?')+'</b><small>Verbindungen</small></div><div><b>'+esc(r.countsAfter?.annotations??'?')+'</b><small>Annotationen</small></div></div>';
 const item=(list,title,cls)=>list.length?'<section class="sync-group '+cls+'"><h3>'+esc(title)+' ('+list.length+')</h3><ul>'+list.slice(0,35).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'+(list.length>35?'<p>Weitere Einträge im JSON-Prüfbericht.</p>':'')+'</section>':'';
 const d=r.differences, changed=d.annotations.fieldsChanged.length+d.nodes.changed.length+d.edges.changed.length;
 return '<p class="sync-file">Datei: '+esc(name)+'</p><div class="sync-state '+(r.status==='BLOCKED'?'sync-blocked':r.status==='READY'?'sync-ready':'sync-review')+'">'+esc(label)+'</div>'+badges+
 '<p>Änderungen: <b>'+changed+'</b> vorhandene Felder/Objekte · <b>'+d.annotations.editorDefaults+'</b> erkannte leere Editor-Standardfelder. Verlorene Herkunftsfelder: <b>'+d.meta.lost.length+'</b> (separat gesichert).</p>'+
 item(r.blockers,'Fehler – Übernahme gesperrt','bad')+item(r.reviewRequired,'Änderungen – manuelle Prüfung','review')+item(r.warnings,'Hinweise','note')+
 (r.anchorsChanged.length?item(r.anchorsChanged,'Geänderte FAQ-Abschnitte','review'):'')+
 '<p class="sync-small">Der Viewer bewahrt FAQ-Index, Qualität und Quellen im lokalen Datenpaket. Die reine VV4-JSON enthält sie weiterhin nicht. Es erfolgt keine SQL- oder PMI-Speicherung.</p>';
}
function syncDialogShow(r,fileName){const el=$('syncDialog');$('syncResult').innerHTML=syncReportMarkup(r,fileName);$('syncApply').disabled=r.status==='BLOCKED';$('syncApproveLabel').textContent=r.status==='REVIEW_REQUIRED'?'Ich habe die Änderungen im Prüfbericht geprüft.':'Ich möchte diese geprüfte Rückexport-Datei übernehmen.';
 $('syncApprove').checked=false;$('syncApply').disabled=true;$('syncImportName').textContent=fileName;el.showModal();}
function beginEditorSync(w,fileName){const r=PMISync.analyze(bundle,w);syncLastReport=r;syncPending=r.status==='BLOCKED'?null:{fileName,source:w,report:r};syncDialogShow(r,fileName);}
function applyEditorSync(){if(!syncPending||!$('syncApprove').checked)return;try{
 const next=PMISync.reconcile(bundle,syncPending.source,syncPending.report);validateViewerBundleStrict(next);
 syncLastAcceptedBundle=JSON.parse(JSON.stringify(bundle));syncLastReport=syncPending.report;prepare(next);void pwaStoreBundle(next);
 $('syncDialog').close();syncPending=null;
 toast('Rückexport übernommen. FAQ-/Quellen-/Qualitätsregister erhalten; Viewer-Paket jetzt exportieren.');
 }catch(e){bundleError('Synchronisierung abgelehnt: '+e.message);$('syncDialog').close();}}
function exportSyncReport(){if(!syncLastReport){toast('Noch keine Synchronisierungsprüfung erfolgt.');return;}
 textDownload(JSON.stringify({...syncLastReport,viewerVersion:'V012',recordedAt:new Date().toISOString(),sourceType:'LOCAL_EDITOR_RETURN_COMPARISON'},null,2),'PMI_V011_EDITOR_SYNC_PRUEFBERICHT.json','application/json;charset=utf-8')}
function exportBackup(){const b=syncLastAcceptedBundle||bundle;textDownload(JSON.stringify(b,null,2),'PMI_V011_BACKUP_VOR_SYNCHRONISIERUNG.json','application/json;charset=utf-8');toast('Lokale Sicherung als vollständiges Viewer-Datenpaket exportiert.')}
function importFile(file){if(!file)return;
 if(file.size>25*1024*1024){bundleError('Datei zu groß: maximal 25 MB JSON.');return}
 const r=new FileReader();r.onerror=()=>bundleError('Datei konnte nicht gelesen werden.');r.onload=()=>{try{
  const b=JSON.parse(r.result);
  if(b?.viewerBundleSchema==='pmi.wissensnavigator.bundle.v1'){
   validateViewerBundleStrict(b);prepare(b);pwaShowWelcome(false);void pwaStoreBundle(b);syncPending=null;toast('Vollständiges Viewer-Datenpaket geladen: '+file.name);
  }else if(b?.meta?.workingSource?.schemaVersion==='vv4.annotation-working-source.v1'){
   beginEditorSync(b,file.name);
  }else throw Error('Unbekanntes JSON: benötigt Viewer-Bundle oder VV4-Annotations-Working-Source.');
 }catch(e){bundleError('Import abgelehnt: '+e.message)}};r.readAsText(file,'utf-8')}

function wire(){document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>chooseView(b.dataset.view));$('query').addEventListener('input',e=>{S.query=e.target.value;renderAll(false)});$('clearQuery').onclick=()=>{S.query='';$('query').value='';renderAll()};$('insertAnd').onclick=()=>{$('query').value+='#';S.query=$('query').value;$('query').focus();renderAll()};$('insertOr').onclick=()=>{$('query').value+='|';S.query=$('query').focus();S.query=$('query').value;renderAll()};for(let key of ['category','proof','scope','sort'])$(key).onchange=e=>{S[key]=e.target.value;renderAll()};$('exact').onchange=e=>{S.exact=e.target.checked;renderAll()};$('advancedJoin').onchange=e=>{S.join=e.target.value;renderAll()};$('addCondition').onclick=()=>{S.advanced.push({field:'all',value:'',not:false,exact:false});renderAll()};$('resetAll').onclick=()=>{S.query='';S.category='all';S.proof='all';S.scope='all';S.advanced=[];S.exact=false;S.join='all';$('query').value='';$('category').value='all';$('proof').value='all';$('scope').value='all';$('exact').checked=false;renderAll()};$('importBtn').onclick=()=>$('fileImport').click();$('syncBtn').onclick=()=>$('syncImport').click();$('fileImport').onchange=e=>{importFile(e.target.files[0]);e.target.value=''};$('syncImport').onchange=e=>{importFile(e.target.files[0]);e.target.value=''};$('syncApprove').onchange=e=>{$('syncApply').disabled=!e.target.checked||!syncPending};$('syncApply').onclick=applyEditorSync;$('syncCancel').onclick=()=>{syncPending=null;$('syncDialog').close()};$('syncExportReport').onclick=exportSyncReport;$('exportSyncAudit').onclick=exportSyncReport;$('exportBackup').onclick=exportBackup;$('exportBundle').onclick=()=>textDownload(JSON.stringify(bundle,null,2),'PMI_VIEWER_DATENPAKET_BACKUP.json','application/json;charset=utf-8');$('exportWorkingSource').onclick=exportWorkingSource;$('exportAudit').onclick=exportIntegrityAudit;$('exportReview').onclick=exportReview;$('printBtn').onclick=()=>window.print();document.querySelectorAll('.utility-menu .top-actions button').forEach(b=>b.addEventListener('click',()=>{document.querySelector('.utility-menu').open=false}));document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('.utility-menu').open=false;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();S.mobilePanel='list';S.view='faq';renderAll();$('query').focus();$('query').select()}})}
pwaStart().catch(e=>{console.error(e);$('criticalError').textContent='PWA konnte nicht gestartet werden: '+e.message;$('criticalError').classList.remove('hidden')})
})();

