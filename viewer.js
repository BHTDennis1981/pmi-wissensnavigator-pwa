
'use strict';
/* PMI Wissensnavigator V011: purely local, read-only, offline. Untrusted content is escaped. */
(function(){
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let bundle=null,faqMap=new Map(),nodeMap=new Map(),edgeMap=new Map(),anns={},qas=new Map(),evidence=new Map(),derived=new Map(),network=null,graphLastHash='';
let syncPending=null, syncLastReport=null, syncLastAcceptedBundle=null;
/* V012 PWA: Alle Wissensdaten ausschließlich lokal (IndexedDB), kein Serverupload. */
const PWA_DB_NAME='pmi-wissensnavigator-v012';
const PWA_STORE='local-bundles';
const PWA_EXT_STORE='local-extensions';
let menuData=null;
let pwaDeferredInstall=null;
function pwaDb(){return new Promise((resolve,reject)=>{
 if(!('indexedDB' in window)){reject(new Error('IndexedDB nicht verfügbar'));return}
 let req=indexedDB.open(PWA_DB_NAME,2);
 req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(PWA_STORE))db.createObjectStore(PWA_STORE);if(!db.objectStoreNames.contains(PWA_EXT_STORE))db.createObjectStore(PWA_EXT_STORE)};
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
 let tx=db.transaction([PWA_STORE,PWA_EXT_STORE],'readwrite');tx.objectStore(PWA_STORE).delete('active');tx.objectStore(PWA_EXT_STORE).delete('active');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
});}finally{db.close()}}
function pwaShowWelcome(show){const el=document.getElementById('pwaWelcome');if(el)el.hidden=!show;}
function pwaSetup(){
 document.getElementById('pwaWelcomeImport').onclick=()=>document.getElementById('fileImport').click();
 const del=document.getElementById('pwaClearLocal');del.onclick=async()=>{
  if(!confirm('Wirklich alle lokalen Wissensdaten UND Menü-/Prozessregister löschen? Vorher bitte eine Gesamtsicherung exportieren.'))return;
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
 try{let existing=await pwaReadBundle();if(existing){validateViewerBundleStrict(existing);prepare(existing);pwaShowWelcome(false);let saved=await pwaReadExtension();if(saved){try{activateExtension(saved);renderAll()}catch(extError){console.warn('Gespeicherte Erweiterung nicht passend',extError);toast('Menü-/Prozessdaten nicht kompatibel. Bitte passende Erweiterung importieren.')}}}else{pwaShowWelcome(true)}}
 catch(e){console.warn('Gespeicherter Wissensbestand nicht ladbar',e);pwaShowWelcome(true);const info=document.getElementById('pwaLocalStatus');if(info)info.textContent='Lokale Daten konnten nicht geladen werden. Bitte Original-JSON erneut importieren.'}
}

const S={menuAction:null,processId:null,menuGroup:'all',view:'faq',faq:null,node:null,tab:'simple',query:'',category:'all',scope:'all',proof:'all',sort:'id',exact:false,advanced:[],join:'all',graphRelation:'all',graphFocus:false,graphMode:'visual',graphScope:'anchor',graphKind:'knowledge',graphLayout:'net',graphProcessId:null,graphShowRefs:false,mobilePanel:'list',filtered:[],visibleNodes:[],remarks:[],searchError:''};
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
S.faq=[...faqMap.keys()][0];S.node=null;S.view='faq';S.tab='simple';S.query='';S.category='all';S.proof='all';S.scope='all';S.advanced=[];S.remarks=[];S.join='all';S.graphRelation='all';S.graphFocus=false;S.graphScope='anchor';S.mobilePanel='list';S.searchError='';if(network){network.destroy();network=null}
$('query').value='';$('category').value='all';$('proof').value='all';$('scope').value='all';$('sort').value='id';$('sourceTag').textContent=(b.manifest?.sourceZip||'ZIP 1824')+' · '+(b.manifest?.knowledgeVersion||'V005')+' Daten';$('schemaTag').textContent='Viewer V023 · Mobile First';$('loadedFile').textContent=b.manifest?.label||'Eingebettete Referenzdaten V005';$('importError').classList.add('hidden');if(menuData&&!extensionCompatible(menuData,b))menuData=null;renderAll();}
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
function chooseView(v){S.view=v;S.mobilePanel=v==='graph'?'detail':'list';if(v==='graph'){S.graphFocus=S.graphScope!=='all';}renderAll()}
function renderNav(){document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===S.view));$('navFaqCount').textContent=faqMap.size;$('navObjectsCount').textContent=nodeMap.size;$('navGraphCount').textContent=edgeMap.size;$('navMenuCount').textContent=menuData?.menus?.length||0;$('navProcessCount').textContent=menuData?.processes?.length||0; if(mobile())requestAnimationFrame(()=>{let active=document.querySelector('.nav-btn.active');if(active)active.scrollIntoView({behavior:'smooth',block:'nearest',inline:'nearest'});updateNavScroll()});}
function renderLeft(){let fs=matchedFaqs();S.filtered=fs;let matchCount=fs.length;$('matchCount').textContent=matchCount+' / '+faqMap.size+' Fragen';$('resetAll').disabled=!(S.query||S.category!=='all'||S.proof!=='all'||S.advanced.length);let items=$('resultList');items.replaceChildren();let title=$('leftTitle'),intro=$('leftIntro');if(S.view==='objects'){title.textContent='Wissensobjekte';intro.textContent=`${nodeMap.size} Knoten, ${edgeMap.size} Beziehungen · Objektliste`;let nodes=matchingObjects();$('matchCount').textContent=nodes.length+' / '+nodeMap.size+' Objekte';for(let n of nodes){let el=document.createElement('button');el.type='button';el.className='result'+(S.node===n.id?' selected':'');el.innerHTML='<div class="id">'+esc(n.id)+'</div><h4>'+esc(n.label)+'</h4><div class="summary">'+esc(anns[n.id]?.summary||'Keine Kurzbeschreibung')+'</div><div class="badges"><span class="chip">'+esc(n.meta?.templateRef?.key||'ohne Template')+'</span></div>';el.onclick=()=>chooseNode(n.id);items.appendChild(el)}if(!nodes.length)items.innerHTML='<div class="empty">Keine Objekte im Such-/Filterkontext</div>';return}
if(S.view==='graph'){title.textContent='Verknüpfte Fragen';intro.textContent='Auswahl fokussiert den Wissensgraph';}
else if(S.view==='quality'){title.textContent='Prüf- und Qualitätsfälle';intro.textContent='Ungeklärte Nachweise und Freigabestatus';}
else if(S.view==='sources'){title.textContent='Quellenbasierte FAQs';intro.textContent='Primärquelle PMI, Arbeitsdateien ergänzend';}
else {title.textContent='FAQ-Katalog';intro.textContent='Suchen, filtern und Fragen auswählen';}
for(let f of fs){let el=document.createElement('button');el.type='button';el.className='result'+(S.faq===f.faqId?' selected':'');el.innerHTML='<div class="row end"><span class="id">'+esc(f.faqId)+'</span><span class="chip">'+esc(f.category)+'</span></div><h4>'+esc(f.question)+'</h4><div class="summary">'+esc(anns[f.primaryAnchor.entityId]?.summary||'')+'</div><div class="badges"><span class="chip warn">Nicht freigegeben</span><span class="chip">PMI: unklassifiziert</span></div>';el.onclick=()=>{S.faq=f.faqId;S.node=null;S.tab='simple';if(S.view==='graph'){S.graphScope='current';S.graphFocus=true;}S.mobilePanel='detail';renderAll()};items.appendChild(el)}if(!fs.length)items.innerHTML='<div class="empty"><b>Keine Treffer</b>Ändere deine Suchbedingungen oder setze die Filter zurück.</div>';
}
function detailHead(title,id,caption){return '<div class="detail-top"><div class="eyebrow">'+esc(id)+'</div><h1>'+esc(title)+'</h1><div class="caption">'+esc(caption)+'</div></div>'}
function detailTabs(tabs){return '<div class="tabrow">'+tabs.map(t=>'<button type="button" class="tab '+(S.tab===t[0]?'active':'')+'" data-tab="'+t[0]+'">'+esc(t[1])+'</button>').join('')+'</div>'}
function renderDetail(){let mid=$('detail');mid.classList.remove('hidden');let f=faqMap.get(S.faq);let body='';if(S.view==='graph'){
 mid.innerHTML=detailHead('Wissensgraph und Prozessabläufe','INTERAKTIVER GRAPH','Knoten wählen, Zusammenhänge erkunden · Prozesskette als redaktioneller Entwurf')+
 '<div class="graph-pane"><div class="graph-tools">'+
 '<label class="graph-field" for="graphKind">Darstellung<select id="graphKind"><option value="knowledge">Wissensnetz</option><option value="process">Teilprozess</option></select></label>'+
 '<label class="graph-field" for="graphLayout">Layout<select id="graphLayout"><option value="net">Freies Netzwerk</option><option value="lr">Ablauf links → rechts</option><option value="ud">Hierarchie oben → unten</option></select></label>'+
 '<label class="graph-field" id="graphProcessField" for="graphProcess">Teilprozess<select id="graphProcess"></select></label>'+
 '<label class="graph-field" id="graphScopeField" for="graphScope">Umfang<select id="graphScope"><option value="anchor">Ein Objekt + Nachbarn</option><option value="current">Aktuelle FAQ + Kontext</option><option value="matches">Suchtreffer + Kontext</option><option value="all">Alle Wissensknoten</option></select></label>'+
 '<label class="graph-field" id="graphRelationField" for="relation">Beziehungen<select id="relation"><option value="all">Alle Beziehungen</option></select></label>'+
 '<label class="graph-check" id="graphRefsField"><input id="graphRefs" type="checkbox"> FAQs und Menüaktionen einblenden</label>'+
 '<button id="graphFit" class="btn tiny">Einpassen</button><button id="graphList" class="btn tiny">Listenansicht</button></div>'+
 '<div id="graphStatus" class="graph-status" role="status"></div><div id="graphCanvas" class="graph-canvas" role="img" aria-label="Interaktiver Wissens- oder Prozessgraph"></div><div id="graphListFallback" class="graph-fallback hidden"></div></div>';
 const relation=$('relation');for(const t of [...new Set([...edgeMap.values()].map(e=>e.relationType))].sort()){let o=document.createElement('option');o.value=t;o.textContent=t;relation.appendChild(o)}
 relation.value=S.graphRelation;$('graphScope').value=S.graphScope;$('graphKind').value=S.graphKind;$('graphLayout').value=S.graphLayout;$('graphRefs').checked=S.graphShowRefs;
 const procSel=$('graphProcess');for(const x of menuData?.processes||[]){const o=document.createElement('option');o.value=x.processId;o.textContent=x.title;procSel.appendChild(o)}
 if(!S.graphProcessId||!menuData?.processes?.some(x=>x.processId===S.graphProcessId))S.graphProcessId=menuData?.processes?.[0]?.processId||null;
 procSel.value=S.graphProcessId||'';
 const controls=()=>{const p=S.graphKind==='process';$('graphProcessField').hidden=!p;$('graphScopeField').hidden=p;$('graphRelationField').hidden=p;$('graphRefsField').hidden=!p;};controls();
 $('graphKind').onchange=()=>{S.graphKind=$('graphKind').value;if(S.graphKind==='process'&&S.graphLayout==='net')S.graphLayout='lr';$('graphLayout').value=S.graphLayout;controls();renderGraph()};
 $('graphLayout').onchange=()=>{S.graphLayout=$('graphLayout').value;renderGraph()};
 $('graphScope').onchange=()=>{S.graphScope=$('graphScope').value;renderGraph()};
 relation.onchange=()=>{S.graphRelation=relation.value;renderGraph()};
 procSel.onchange=()=>{S.graphProcessId=procSel.value;renderGraph()};
 $('graphRefs').onchange=()=>{S.graphShowRefs=$('graphRefs').checked;renderGraph()};
 $('graphFit').onclick=()=>network?.fit({animation:{duration:280,easingFunction:'easeInOutQuad'}});
 $('graphList').onclick=()=>{S.graphMode=S.graphMode==='visual'?'list':'visual';renderGraph()};
 setTimeout(renderGraph,0);return;
 }
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
function renderGraph(){
 if(S.view!=='graph')return;
 const canvas=$('graphCanvas'),fallback=$('graphListFallback'),msg=$('graphStatus');if(!canvas||!fallback)return;
 let nodes=[],edges=[],selectedNodes=new Set(),dimMode=false,navMap=new Map();
 const processMode=S.graphKind==='process';
 if(processMode){
  const p=menuData?.processes?.find(x=>x.processId===S.graphProcessId);
  if(!p){if(network){network.destroy();network=null}canvas.classList.add('hidden');fallback.classList.remove('hidden');fallback.innerHTML='<div class="empty">Bitte zuerst das private Menü-/Prozessregister importieren.</div>';msg.textContent='Keine Prozessdaten geladen.';return}
  const seen=new Set();
  const addNode=(n,nav)=>{if(seen.has(n.id))return;seen.add(n.id);nodes.push(n);navMap.set(n.id,nav)};
  p.steps.forEach((step,i)=>{
   const id='step:'+p.processId+':'+step.stepId;
   addNode({id,label:(i+1)+'. '+step.title,shape:'box',level:i*2,color:{background:'#d0f0e9',border:'#21877b'},font:{color:'#163e45',size:14,face:'Arial'},margin:13,title:esc((step.evidenceStrength||'Prüfstatus offen')+'\nNicht Ende-zu-Ende geprüft')},{type:'step',processId:p.processId,stepId:step.stepId});
   if(i>0)edges.push({id:'flow:'+i,from:'step:'+p.processId+':'+p.steps[i-1].stepId,to:id,arrows:'to',width:2.5,color:{color:'#127b84'},title:'Redaktionelle Schrittfolge; keine Laufzeitmessung'});
   if(S.graphShowRefs){
    for(const fid of step.faqRefs||[]){if(!faqMap.has(fid))continue;const ref='faq:'+fid;addNode({id:ref,label:'FAQ: '+fid,shape:'box',level:i*2+1,color:{background:'#dfebfa',border:'#7f9dc0'},font:{size:11,color:'#294057'},margin:8},{type:'faq',faqId:fid});edges.push({id:'faqedge:'+i+':'+fid,from:id,to:ref,dashes:true,arrows:'to',color:{color:'#96adc6'},title:'Dokumentationsverweis, kein automatischer Ablauf'})}
    for(const mid of step.menuActionKeys||[]){const a=menuData?.menus?.find(x=>x.actionKey===mid);if(!a)continue;const ref='menu:'+mid;addNode({id:ref,label:'Menü: '+a.labelStatic,shape:'box',level:i*2+1,color:{background:'#faeddb',border:'#c49a58'},font:{size:11,color:'#624523'},margin:8},{type:'menu',actionKey:mid});edges.push({id:'menuedge:'+i+':'+mid,from:id,to:ref,dashes:true,arrows:'to',color:{color:'#c9ad80'},title:'Statischer Menübezug, keine Browser- oder Rollenfreigabe'})}
   }
  });
  msg.textContent=p.title+' · '+p.steps.length+' Schritte · redaktioneller Ablaufentwurf, nicht Ende-zu-Ende getestet'+(S.graphShowRefs?' · mit Quellverweisen':'')+(mobile()?' · Grafik verschieben / mit zwei Fingern zoomen':'');
 }else{
  const graphFaqs=['current','anchor'].includes(S.graphScope)?[faqMap.get(S.faq)].filter(Boolean):matchedFaqs();
  selectedNodes=S.graphScope==='anchor'?new Set(graphFaqs.map(f=>f.primaryAnchor.entityId)):new Set(graphFaqs.flatMap(f=>[f.primaryAnchor.entityId,...(f.relatedEntities||[]).map(e=>e.entityId)]));
  edges=[...edgeMap.values()].filter(e=>S.graphRelation==='all'||e.relationType===S.graphRelation);
  let visible=new Set(nodeMap.keys());
  if(S.graphScope!=='all'){visible=new Set(selectedNodes);for(const e of edges)if(selectedNodes.has(e.from)||selectedNodes.has(e.to)){visible.add(e.from);visible.add(e.to)}}
  edges=edges.filter(e=>visible.has(e.from)&&visible.has(e.to));
  nodes=[...nodeMap.values()].filter(n=>visible.has(n.id)).map(n=>({id:n.id,label:n.label,title:esc((anns[n.id]?.title||n.label)+'\n'+n.id),shape:'box',borderWidth:selectedNodes.has(n.id)?2:1,font:{color:'#254251',size:12,face:'Arial'},color:{background:graphNodeColor(n,selectedNodes.has(n.id),false),border:selectedNodes.has(n.id)?'#087e86':'#9dbac6',highlight:{background:'#ffdfaa',border:'#e0a34a'}},margin:8}));
  edges=edges.map(e=>({id:e.id,from:e.from,to:e.to,title:esc(e.relationType+': '+(e.label||'')),arrows:'to',dashes:e.relationType==='documents',width:e.relationType==='documents'?1.8:1.1,color:{color:e.relationType==='documents'?'#087e86':'#b6c4cb',opacity:.8}}));
  msg.textContent=nodes.length+' Wissensobjekte · '+edges.length+' Beziehungen · '+(S.graphScope==='all'?'Gesamtnetz':'Eingegrenzter Ausschnitt')+' · Dokumentationskanten sind keine Laufzeitaufrufe';
 }
 if(network){network.destroy();network=null}fallback.innerHTML='';
 if(S.graphMode==='list'||typeof vis==='undefined'||typeof vis.Network!=='function'){
  canvas.classList.add('hidden');fallback.classList.remove('hidden');$('graphList').textContent='Graph anzeigen';
  fallback.innerHTML='<div class="pad"><b>'+(processMode?'Prozessschritte':'Wissensobjekte')+' · '+nodes.length+'</b></div>'+nodes.map(n=>'<button class="result" data-graph-node="'+esc(n.id)+'"><span class="id">'+esc(n.id)+'</span><h4>'+esc(n.label)+'</h4></button>').join('');
  fallback.querySelectorAll('[data-graph-node]').forEach(b=>b.onclick=()=>graphSelectNode(b.dataset.graphNode,navMap));return;
 }
 canvas.classList.remove('hidden');fallback.classList.add('hidden');$('graphList').textContent='Listenansicht';
 const directed=S.graphLayout!=='net',hierarchical=directed?{enabled:true,direction:S.graphLayout==='lr'?'LR':'UD',sortMethod:'directed',levelSeparation:processMode?185:165,nodeSpacing:processMode?105:85,treeSpacing:180,blockShifting:true,edgeMinimization:true}:false;
 const options={autoResize:true,layout:{improvedLayout:!directed,randomSeed:105,hierarchical},physics:directed?{enabled:false}:{enabled:true,solver:'barnesHut',barnesHut:{gravitationalConstant:-2400,centralGravity:.1,springLength:135,springConstant:.018,damping:.35},stabilization:{iterations:170}},interaction:{hover:!mobile(),navigationButtons:!mobile(),keyboard:!mobile()},nodes:{shape:'box'},edges:{smooth:directed?{enabled:true,type:'cubicBezier',forceDirection:S.graphLayout==='lr'?'horizontal':'vertical',roundness:.24}:{enabled:true,type:'dynamic'}}};
 try{
  network=new vis.Network(canvas,{nodes:new vis.DataSet(nodes),edges:new vis.DataSet(edges)},options);
  let current=network;
  if(!directed)current.once('stabilized',()=>{if(network!==current)return;current.setOptions({physics:{enabled:false}});current.fit({animation:false})});
  else current.once('afterDrawing',()=>{requestAnimationFrame(()=>{if(network!==current)return;if(processMode&&mobile()&&nodes.length){current.focus(nodes[0].id,{scale:.85,animation:false});}else current.fit({animation:false})})});
  current.on('click',p=>{if(p.nodes.length)graphSelectNode(p.nodes[0],navMap);else if(!processMode&&p.edges.length)chooseNode(p.edges[0])});
 }catch(e){console.error('Graph nicht darstellbar',e);S.graphMode='list';renderGraph()}
}
function graphSelectNode(id,navMap){
 const n=navMap.get(id);
 if(n?.type==='faq'){chooseFaq(n.faqId);return}
 if(n?.type==='menu'){chooseMenu(n.actionKey);return}
 if(n?.type==='step'){
  chooseProcess(n.processId);
  requestAnimationFrame(()=>document.querySelectorAll('[data-process-step]').forEach(el=>{if(el.dataset.processStep===n.stepId)el.scrollIntoView({block:'center',behavior:'smooth'})}));
  return;
 }
 chooseNode(id);
}
function renderFilters(){let box=$('advancedRows');box.innerHTML='';S.advanced.forEach((a,i)=>{let row=document.createElement('div');row.className='filtergroup';row.innerHTML='<div class="row end"><span class="filter-title">Bedingung '+(i+1)+'</span><button class="btn tiny" data-del="'+i+'" type="button">Entfernen</button></div><div class="filteritem"><select data-idx="'+i+'" data-prop="field"><option value="all">Gesamter Inhalt</option><option value="title">Frage</option><option value="id">FAQ-ID</option><option value="user">Erklärung</option><option value="tech">Technik</option><option value="review">Prüfung</option><option value="object">Objekte</option><option value="source">Quellen</option></select><select data-idx="'+i+'" data-prop="not"><option value="0">enthält</option><option value="1">enthält nicht</option></select><button class="btn tiny" disabled>⊙</button><input data-idx="'+i+'" data-prop="value" placeholder="Suchwert" value="'+esc(a.value)+'"></div>';box.appendChild(row);row.querySelector('[data-prop="field"]').value=a.field;row.querySelector('[data-prop="not"]').value=a.not?'1':'0'});box.querySelectorAll('[data-del]').forEach(x=>x.onclick=()=>{S.advanced.splice(+x.dataset.del,1);renderAll()});box.querySelectorAll('[data-prop]').forEach(x=>x.addEventListener(x.tagName==='INPUT'?'input':'change',()=>{let v=S.advanced[+x.dataset.idx];if(x.dataset.prop==='not')v.not=x.value==='1';else v[x.dataset.prop]=x.value;renderAll(false)}));$('advancedJoin').value=S.join;}
function mobileToolbar(){const mid=$('detail');mid.querySelectorAll('.mobile-detailbar').forEach(e=>e.remove());mid.querySelectorAll('.mobile-read-footer').forEach(e=>e.remove());
if(S.view!=='graph'){
 const bar=document.createElement('div');bar.className='mobile-detailbar';
 const back=document.createElement('button');back.className='mobile-back';back.type='button';back.textContent='← Zurück';back.onclick=()=>{S.mobilePanel='list';renderAll();};bar.appendChild(back);
 if(S.view==='faq' || S.view==='quality' || S.view==='sources'){
   const f=faqMap.get(S.faq);const index=matchedFaqs().findIndex(x=>x.faqId===S.faq);const span=document.createElement('span');span.className='mobile-position';span.textContent=index>=0?(index+1)+' / '+matchedFaqs().length:'FAQ';bar.appendChild(span);
 }
 const focus=document.createElement('button');focus.className='mobile-context';focus.type='button';focus.textContent='◎ Graph';focus.onclick=()=>{S.view='graph';S.graphScope='anchor';S.graphFocus=true;S.mobilePanel='detail';renderAll()};bar.appendChild(focus);mid.prepend(bar);
 if(S.view==='faq'){
 const article=mid.querySelector('.article');if(article){const fs=matchedFaqs(),index=fs.findIndex(f=>f.faqId===S.faq);const footer=document.createElement('div');footer.className='mobile-read-footer';
 for(const [label,idx] of [['← Vorherige',index-1],['Nächste →',index+1]]){const btn=document.createElement('button');btn.type='button';btn.textContent=label;btn.disabled=idx<0||idx>=fs.length;btn.onclick=()=>{if(idx>=0&&idx<fs.length){S.faq=fs[idx].faqId;S.tab='simple';S.mobilePanel='detail';renderAll()}};footer.appendChild(btn)}article.appendChild(footer)
 }
 }
 }
}
function mobileLayout(){document.body.dataset.mobilePanel=S.view==='graph'?'detail':S.mobilePanel;}
function renderAll(doFilters=true){if(!bundle)return;if(S.view!=='graph'&&network){network.destroy();network=null;}renderNav();if(S.view==='menus'||S.view==='processes'){renderExtensionView();mobileToolbar();mobileLayout();return;}document.body.classList.remove('ext-view');$('menuFilters').hidden=true;$('faqFilterPanel').hidden=false;renderLeft();renderDetail();renderAside();mobileToolbar();mobileLayout();if(doFilters)renderFilters();$('statusInfo').textContent=`${faqMap.size} FAQs · ${nodeMap.size} Knoten · ${edgeMap.size} Kanten · ${Object.keys(anns).length} Annotationen`;$('statusResult').textContent=S.filtered.length+' Treffer';}
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
/* V023 – lokale Menüpunkte und Teilprozesse. Keine Handler-Ausführung und keine externen Hilfelinks. */
async function pwaReadExtension(){let db=await pwaDb();try{return await new Promise((resolve,reject)=>{let r=db.transaction(PWA_EXT_STORE,'readonly').objectStore(PWA_EXT_STORE).get('active');r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)})}finally{db.close()}}
async function pwaStoreExtension(next){try{let db=await pwaDb();try{await new Promise((resolve,reject)=>{let t=db.transaction(PWA_EXT_STORE,'readwrite');t.objectStore(PWA_EXT_STORE).put(next,'active');t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error)})}finally{db.close()}}catch(e){console.warn('Menü-/Prozessdaten konnten nicht gespeichert werden',e);toast('Speichern fehlgeschlagen: Bitte Gesamtsicherung exportieren.')}}
async function pwaStorePair(core,ext){try{let db=await pwaDb();try{await new Promise((resolve,reject)=>{let t=db.transaction([PWA_STORE,PWA_EXT_STORE],'readwrite');t.objectStore(PWA_STORE).put(core,'active');t.objectStore(PWA_EXT_STORE).put(ext,'active');t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error)})}finally{db.close()}}catch(e){console.warn('Gesamtdaten konnten nicht gespeichert werden',e);toast('Speichern fehlgeschlagen: Bitte Gesamtsicherung exportieren.')}}
function extensionCompatible(e,b){return !!e&&!!b&&e.sourceArchiveSha256===b.manifest?.sourceArchiveSha256&&e.compatibleDocumentKey===b.faqIndex?.workingSourceDocumentKey;}
function validateExtension(e,b){
 if(!e||e.schema!=='pmi.wissensnavigator.extensions.v1'||!Array.isArray(e.menus)||!Array.isArray(e.processes))throw Error('Ungültiges Menü-/Prozessdaten-Schema.');
 if(!extensionCompatible(e,b))throw Error('Quellversion oder VV4-Dokumentidentität passen nicht zum Viewer-Datenbestand.');
 if(e.menus.length>10000||e.processes.length>2000)throw Error('Register überschreitet die Sicherheitsgrenze.');
 const keys=new Set(),pids=new Set(),faqids=new Set(b.faqIndex.entries.map(x=>x.faqId));
 for(const a of e.menus){if(typeof a.actionKey!=='string'||!a.actionKey||keys.has(a.actionKey)||typeof a.labelStatic!=='string'||!Array.isArray(a.faqLinks)||!Array.isArray(a.processStepRefs))throw Error('Doppelte oder fehlerhafte Menüaktion.');keys.add(a.actionKey);for(const f of a.faqLinks)if(!faqids.has(f))throw Error('Menü verweist auf unbekannte FAQ: '+f)}
 for(const p of e.processes){if(typeof p.processId!=='string'||!p.processId||pids.has(p.processId)||typeof p.title!=='string'||!Array.isArray(p.steps))throw Error('Fehlerhafter Teilprozess.');pids.add(p.processId);const steps=new Set();for(const s of p.steps){if(!s.stepId||steps.has(s.stepId)||!Array.isArray(s.faqRefs)||!Array.isArray(s.menuActionKeys))throw Error('Ungültiger Prozessschritt.');steps.add(s.stepId);for(const f of s.faqRefs)if(!faqids.has(f))throw Error('Prozess enthält unbekannte FAQ: '+f);for(const a of s.menuActionKeys)if(!keys.has(a))throw Error('Prozess enthält unbekannte Menüaktion: '+a)}}
 for(const a of e.menus)for(const ref of a.processStepRefs){if(typeof ref!=='string'||!e.processes.some(p=>p.steps.some(s=>ref===p.processId+'/'+s.stepId)))throw Error('Menü enthält ungültige Prozessreferenz: '+ref)}
 return true;
}
function activateExtension(ext){validateExtension(ext,bundle);menuData=ext;S.menuAction=ext.menus[0]?.actionKey||null;S.processId=ext.processes[0]?.processId||null;S.menuGroup='all';}
function exportFullBackup(){if(!bundle)return;const b={schema:'pmi.wissensnavigator.full-backup.v023',createdAt:new Date().toISOString(),coreBundle:bundle,extension:menuData};if(!menuData){toast('Keine Menü-/Prozessdaten geladen; nur FAQ-Daten vorhanden.');textDownload(JSON.stringify(bundle,null,2),'PMI_VIEWER_FAQ_BACKUP.json','application/json;charset=utf-8');return}textDownload(JSON.stringify(b,null,2),'PMI_WISSENSNAVIGATOR_GESAMTBACKUP_V023.json','application/json;charset=utf-8');toast('Gesamtsicherung mit FAQs, Graph und Menü-/Prozessregistern exportiert.');}
function chooseMenu(k){if(!menuData?.menus.some(a=>a.actionKey===k))return;S.menuAction=k;S.view='menus';S.mobilePanel='detail';renderAll();}
function chooseProcess(k){if(!menuData?.processes.some(p=>p.processId===k))return;S.processId=k;S.view='processes';S.mobilePanel='detail';renderAll();}
function menuMatch(a){if(S.menuGroup!=='all'&&a.groupStatic!==S.menuGroup)return false;const corpus=[a.actionKey,a.labelStatic,a.groupStatic,a.primaryCallName,a.handlerExpression,a.context?.ruleClass,a.context?.possibleBranchKeys?.join(' '),(a.faqLinks||[]).join(' ')].join(' ');return matchQuery(corpus)}
function processMatch(p){const corpus=[p.processId,p.title,p.trigger,p.scope,JSON.stringify(p.steps?.map(s=>[s.title,s.faqRefs,s.menuActionKeys]))].join(' ');return matchQuery(corpus)}
function wireExtensionLinks(root){root.querySelectorAll('[data-menu]').forEach(x=>x.onclick=()=>chooseMenu(x.dataset.menu));root.querySelectorAll('[data-process]').forEach(x=>x.onclick=()=>chooseProcess(x.dataset.process));root.querySelectorAll('[data-faq]').forEach(x=>x.onclick=()=>chooseFaq(x.dataset.faq));root.querySelectorAll('[data-graphfaq]').forEach(x=>x.onclick=()=>{const f=faqMap.get(x.dataset.graphfaq);if(!f)return;S.faq=f.faqId;S.view='graph';S.graphKind='knowledge';S.graphScope='anchor';S.mobilePanel='detail';renderAll()});root.querySelectorAll('[data-process-graph]').forEach(x=>x.onclick=()=>{S.graphKind='process';S.graphProcessId=x.dataset.processGraph;S.graphLayout='lr';S.graphMode='visual';S.view='graph';S.mobilePanel='detail';renderAll()});}
function extensionFaqButtons(ids){return (ids||[]).filter(id=>faqMap.has(id)).map(id=>'<button type="button" class="ext-ref" data-faq="'+esc(id)+'">'+esc(id)+' · '+esc(faqMap.get(id).question)+'</button>').join('')||'<p class="ext-muted">Noch kein direkt zugeordneter FAQ-Beleg.</p>'}
function renderExtensionView(){
 document.body.classList.add('ext-view');$('faqFilterPanel').hidden=true;$('menuFilters').hidden=S.view!=='menus';
 const lst=$('resultList'),mid=$('detail'),aside=$('asideBody'),men=S.view==='menus',data=menuData;
 $('leftTitle').textContent=men?'Menüpunkte':'Teilprozesse';$('leftIntro').textContent=men?'Quellcode-Katalog · kein Live-Menü':'Fachlich verknüpfte Ablaufentwürfe';
 lst.replaceChildren();
 if(!data){$('matchCount').textContent='0 Treffer';mid.innerHTML='<div class="empty"><h2>Menü-/Prozessdaten lokal importieren</h2><p>Dieser Bereich benötigt das private V023-Erweiterungsregister oder das V023-Komplettpaket. Die öffentliche PWA enthält bewusst keine internen Daten.</p><button class="btn primary" id="extQuickImport">Register importieren</button></div>';let btn=$('extQuickImport');btn.onclick=()=>$('fileExtension').click();aside.innerHTML='<div class="aside-card">Interne Wissensdaten werden ausschließlich lokal verarbeitet.</div>';$('statusResult').textContent='Keine Erweiterung';return;}
 if(men){const select=$('menuGroup');const groups=[...new Set(data.menus.map(a=>a.groupStatic||'Ohne Gruppe'))].sort((a,b)=>a.localeCompare(b,'de'));if(select.options.length!==groups.length+1){select.replaceChildren();for(const [v,t] of [['all','Alle Gruppen'],...groups.map(g=>[g,g])]){const opt=document.createElement('option');opt.value=v;opt.textContent=t;select.appendChild(opt)}}select.value=S.menuGroup;if(select.value!==S.menuGroup){S.menuGroup='all';select.value='all'}}
 const list=men?data.menus.filter(menuMatch):data.processes.filter(processMatch);S.filtered=list;
 $('matchCount').textContent=list.length+' / '+(men?data.menus.length:data.processes.length)+' '+(men?'Menüaktionen':'Prozesse');$('statusInfo').textContent=faqMap.size+' FAQs · '+data.menus.length+' Menü-Kandidaten · '+data.processes.length+' Teilprozess-Entwürfe';$('statusResult').textContent=list.length+' Treffer';
 for(const entry of list){const key=men?entry.actionKey:entry.processId,label=men?entry.labelStatic:entry.title,active=men?S.menuAction===key:S.processId===key;const el=document.createElement('button');el.type='button';el.className='result'+(active?' selected':'');el.innerHTML='<div class="id">'+esc(key)+'</div><h4>'+esc(label)+'</h4><div class="summary">'+esc(men?(entry.groupStatic||'Menüaktion'):(entry.trigger||'Teilprozess-Entwurf'))+'</div><div class="badges"><span class="chip warn">'+(men?'Statisch erfasst':'Nicht End-to-End geprüft')+'</span></div>';el.onclick=()=>men?chooseMenu(key):chooseProcess(key);lst.appendChild(el)}
 if(!list.length)lst.innerHTML='<div class="empty">Keine passenden Einträge. Suche oder Gruppe anpassen.</div>';
 if(men){let a=data.menus.find(x=>x.actionKey===S.menuAction);if(!a){a=list[0]||data.menus[0];S.menuAction=a?.actionKey}renderMenuDetail(a,mid,aside)}
 else{let p=data.processes.find(x=>x.processId===S.processId);if(!p){p=list[0]||data.processes[0];S.processId=p?.processId}renderProcessDetail(p,mid,aside)}
 wireExtensionLinks(mid);wireExtensionLinks(aside);
}
function renderMenuDetail(a,mid,aside){
 if(!a){mid.innerHTML='<div class="empty">Keine Menüaktion ausgewählt.</div>';aside.replaceChildren();return}
 const context=a.context||{},refs=a.processStepRefs||[],cands=a.implementationCandidates||[];
 mid.innerHTML=detailHead(a.labelStatic,'MENÜAKTION · '+a.actionKey,'Statischer Codebeleg aus '+(menuData?.sourceVersionId||'Quellversion')+' · keine bestätigte Laufzeitsichtbarkeit')+
 '<div class="scroll"><div class="article ext-article"><div class="callout">Im Code vorhanden ≠ tatsächlich angezeigt, ausführbar oder für eine Rolle freigegeben. Der Katalog erfasst noch nicht alle Anwendungen.</div>'+
 '<section><div class="section-kicker">Einordnung</div><p><b>Gruppe:</b> '+esc(a.groupStatic||'–')+' · <b>Seite:</b> '+esc(a.side||'–')+'</p><p><b>Kontextprüfung:</b> '+esc(context.ruleClass||'nicht nachgewiesen')+'</p><p><b>Regelstand:</b> '+esc(context.resolution||'offen')+'</p><p><b>Codebedingung:</b> '+esc(typeof context.declaredVisibleWhen==='string'?context.declaredVisibleWhen:JSON.stringify(context.declaredVisibleWhen??'nicht erfasst'))+'</p><p><b>Nutzer-/Expertenbedingung im Code:</b> '+(context.hasExplicitUserOrExpertPredicate?'vorhanden (nicht live geprüft)':'nicht explizit ermittelt')+'</p>'+(context.possibleBranchKeys?.length?'<p><b>Mögliche Codezweige:</b> '+esc(context.possibleBranchKeys.join(' · '))+'</p>':'<p class="ext-muted">Keine statisch eindeutigen Kontextzweige ermittelt.</p>')+'</section>'+
 '<section><div class="section-kicker">Programmaufruf (nicht ausgeführt)</div><code class="ext-code">'+esc(a.handlerExpression||'Kein direkter Aufruf erfasst')+'</code><p><b>Funktionskandidat:</b> '+esc(a.primaryCallName||'nicht ermittelt')+'</p></section>'+
 '<section><div class="section-kicker">Implementierungsbelege</div>'+(cands.slice(0,8).map(c=>'<div class="ext-proof"><code>'+esc(c.path||'')+(c.line?' : '+esc(c.line):'')+'</code><small>'+esc(c.proofLevel||'statischer Fund')+'</small></div>').join('')||'<p>Keine Implementierungsdeklaration gefunden.</p>')+'</section>'+
 '<section><div class="section-kicker">Verknüpfte FAQs</div>'+extensionFaqButtons(a.faqLinks)+(a.faqLinks?.length?'<button class="ext-ref" data-graphfaq="'+esc(a.faqLinks[0])+'">Graph zur zugeordneten FAQ öffnen</button>':'')+'</section>'+
 '<section><div class="section-kicker">Teilprozesse</div>'+(refs.map(ref=>{const id=ref.split('/')[0];const p=menuData.processes.find(x=>x.processId===id);return p?'<button class="ext-ref" data-process="'+esc(id)+'">'+esc(p.title)+' · Schritt '+esc(ref.split('/')[1]||'')+'</button>':''}).join('')||'<p class="ext-muted">Noch keine Prozessstelle zugeordnet.</p>')+'</section>'+
 '<section><div class="section-kicker">Hilfe / DocWiki</div><div class="callout">Noch keine freigegebene DocWiki-Verknüpfung vorhanden. Lokale FAQs können bereits geöffnet werden; externe Hilfe wird nicht erfunden.</div><button class="btn" id="menuHelp" '+(!(a.faqLinks||[]).length?'disabled':'')+'>Lokale FAQ-Hilfe anzeigen</button></section>'+
 '</div></div>';
 const help=$('menuHelp');if(help)help.onclick=()=>chooseFaq(a.faqLinks[0]);
 aside.innerHTML='<div class="aside-card"><h3>Quellenstand</h3><p><b>'+esc(menuData?.sourceVersionId)+'</b></p><code>'+esc(a.source?.path||'')+':'+esc(a.source?.line||'–')+'</code><p class="ext-muted">SHA-256: <code>'+esc(a.source?.sha256||'–')+'</code></p></div><div class="aside-card"><h3>Prüfgrenzen</h3><p>Rollenberechtigung: offen</p><p>Live-Sichtbarkeit: offen</p><p>Ausführung / Schreibzugriff: nicht getestet</p><p>DocWiki-Freigabe: nicht vorhanden</p></div>';
}
function renderProcessDetail(p,mid,aside){
 if(!p){mid.innerHTML='<div class="empty">Kein Teilprozess ausgewählt.</div>';aside.replaceChildren();return}
 const steps=p.steps||[];
 mid.innerHTML=detailHead(p.title,'TEILPROZESS · '+p.processId,'Quellengebundener Ablaufentwurf · keine End-to-End-Abnahme')+
 '<div class="scroll"><div class="article ext-article"><div class="callout">Die Schritte wurden redaktionell aus PMI und Codebelegen verknüpft. Sie sind kein getestetes Tutorial und lösen keine ERP-Aktion aus.</div>'+
 '<section><div class="section-kicker">Auslöser und Voraussetzungen</div><p><b>Auslöser:</b> '+esc(p.trigger||'nicht erfasst')+'</p><ul>'+(p.preconditions||[]).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></section>'+
 '<section><button class="ext-ref" data-process-graph="'+esc(p.processId)+'">◎ Prozess grafisch anzeigen</button></section><section><div class="section-kicker">Schrittfolge · '+steps.length+'</div><ol class="ext-steps">'+steps.map(s=>'<li data-process-step="'+esc(s.stepId)+'"><h3>'+esc(s.title)+'</h3><p class="ext-muted">'+esc(s.evidenceStrength||'Belegstatus offen')+'</p><div class="ext-links">'+(s.menuActionKeys||[]).map(k=>{let a=menuData.menus.find(m=>m.actionKey===k);return a?'<button class="ext-ref" data-menu="'+esc(k)+'">Menü: '+esc(a.labelStatic)+'</button>':''}).join('')+extensionFaqButtons(s.faqRefs)+'</div>'+(s.mappingStatusV020?'<p class="ext-muted">'+esc(s.mappingStatusV020)+'</p>':'')+'</li>').join('')+'</ol></section>'+
 '<section><div class="section-kicker">Entscheidungen und Sonderfälle</div><p><b>Beteiligte Rollen (redaktionell):</b> '+esc((p.roles||[]).join(' · ')||'offen')+'</p><ul>'+(p.decisions||[]).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul><p><b>Fehler- und Sonderfälle:</b></p><ul>'+(p.failureScenarios||[]).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></section>'+
 '<section><div class="section-kicker">Ergebnis und Prüfgrenzen</div><p>'+esc(p.result||p.expectedResult||p.outcome||'Ergebnis im Pilot fachlich noch zu verifizieren.')+'</p><p>Produktive Berechtigungs-, Rückmelde- und Schreibtests sind separat erforderlich.</p></section></div></div>';
 let faqCount=[...new Set(steps.flatMap(s=>s.faqRefs||[]))].length,actCount=[...new Set(steps.flatMap(s=>s.menuActionKeys||[]))].length;
 aside.innerHTML='<div class="aside-card"><h3>Teilprozess</h3><p><b>'+steps.length+'</b> dokumentierte Schritte</p><p>'+faqCount+' verknüpfte FAQs · '+actCount+' Menüaktionen</p><p>Quellversion: '+esc(menuData?.sourceVersionId)+'</p></div><div class="aside-card"><h3>Freigabe</h3><span class="chip warn">Redaktioneller Entwurf</span><p>Keine Live-End-to-End-Prüfung und kein freigegebenes Tutorial.</p></div>';
}

function importFile(file){if(!file)return;
 if(file.size>25*1024*1024){bundleError('Datei zu groß: maximal 25 MB JSON.');return}
 const r=new FileReader();r.onerror=()=>bundleError('Datei konnte nicht gelesen werden.');r.onload=()=>{try{
  const b=JSON.parse(r.result);
  if(b?.schema==='pmi.wissensnavigator.full-backup.v023'){
    validateViewerBundleStrict(b.coreBundle);validateExtension(b.extension,b.coreBundle);prepare(b.coreBundle);activateExtension(b.extension);pwaShowWelcome(false);void pwaStorePair(b.coreBundle,b.extension);syncPending=null;renderAll();toast('Wissenspaket mit Menü-/Prozessdaten geladen.');
   }else if(b?.schema==='pmi.wissensnavigator.extensions.v1'){
    if(!bundle)throw Error('Zuerst ein passendes FAQ-Viewer-Datenpaket importieren.');activateExtension(b);void pwaStoreExtension(b);renderAll();toast('Menü- und Prozessregister geladen.');
   }else if(b?.viewerBundleSchema==='pmi.wissensnavigator.bundle.v1'){
   validateViewerBundleStrict(b);prepare(b);pwaShowWelcome(false);void pwaStoreBundle(b);syncPending=null;toast('Vollständiges Viewer-Datenpaket geladen: '+file.name);
  }else if(b?.meta?.workingSource?.schemaVersion==='vv4.annotation-working-source.v1'){
   beginEditorSync(b,file.name);
  }else throw Error('Unbekanntes JSON: benötigt Viewer-Bundle, V023-Komplettpaket, V023-Erweiterung oder VV4-Working-Source.');
 }catch(e){bundleError('Import abgelehnt: '+e.message)}};r.readAsText(file,'utf-8')}

function updateNavScroll(){const n=$('mainNavigation');if(!n)return;const back=document.querySelector('.nav-prev'),next=document.querySelector('.nav-next');if(back)back.disabled=n.scrollLeft<=3;if(next)next.disabled=n.scrollLeft+n.clientWidth>=n.scrollWidth-3;}
function wire(){const nav=$('mainNavigation');if(nav){nav.addEventListener('scroll',updateNavScroll,{passive:true});window.addEventListener('resize',updateNavScroll);document.querySelector('.nav-prev')?.addEventListener('click',()=>nav.scrollBy({left:-230,behavior:'smooth'}));document.querySelector('.nav-next')?.addEventListener('click',()=>nav.scrollBy({left:230,behavior:'smooth'}));}document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>chooseView(b.dataset.view));$('query').addEventListener('input',e=>{S.query=e.target.value;renderAll(false)});$('clearQuery').onclick=()=>{S.query='';$('query').value='';renderAll()};$('insertAnd').onclick=()=>{$('query').value+='#';S.query=$('query').value;$('query').focus();renderAll()};$('insertOr').onclick=()=>{$('query').value+='|';S.query=$('query').focus();S.query=$('query').value;renderAll()};for(let key of ['category','proof','scope','sort'])$(key).onchange=e=>{S[key]=e.target.value;renderAll()};$('exact').onchange=e=>{S.exact=e.target.checked;renderAll()};$('advancedJoin').onchange=e=>{S.join=e.target.value;renderAll()};$('addCondition').onclick=()=>{S.advanced.push({field:'all',value:'',not:false,exact:false});renderAll()};$('resetAll').onclick=()=>{S.query='';S.category='all';S.proof='all';S.scope='all';S.advanced=[];S.exact=false;S.join='all';$('query').value='';$('category').value='all';$('proof').value='all';$('scope').value='all';$('exact').checked=false;renderAll()};$('importBtn').onclick=()=>$('fileImport').click();$('syncBtn').onclick=()=>$('syncImport').click();$('fileImport').onchange=e=>{importFile(e.target.files[0]);e.target.value=''};$('syncImport').onchange=e=>{importFile(e.target.files[0]);e.target.value=''};$('syncApprove').onchange=e=>{$('syncApply').disabled=!e.target.checked||!syncPending};$('syncApply').onclick=applyEditorSync;$('syncCancel').onclick=()=>{syncPending=null;$('syncDialog').close()};$('syncExportReport').onclick=exportSyncReport;$('exportSyncAudit').onclick=exportSyncReport;$('exportBackup').onclick=exportBackup;$('exportFullBackup').onclick=exportFullBackup;$('menuGroup').onchange=e=>{S.menuGroup=e.target.value;renderAll();};$('importExtensionBtn').onclick=()=>$('fileExtension').click();$('fileExtension').onchange=e=>{importFile(e.target.files[0]);e.target.value='';};$('exportBundle').onclick=()=>textDownload(JSON.stringify(bundle,null,2),'PMI_VIEWER_DATENPAKET_BACKUP.json','application/json;charset=utf-8');$('exportWorkingSource').onclick=exportWorkingSource;$('exportAudit').onclick=exportIntegrityAudit;$('exportReview').onclick=exportReview;$('printBtn').onclick=()=>window.print();document.querySelectorAll('.utility-menu .top-actions button').forEach(b=>b.addEventListener('click',()=>{document.querySelector('.utility-menu').open=false}));document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('.utility-menu').open=false;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();S.mobilePanel='list';S.view='faq';renderAll();$('query').focus();$('query').select()}})}
pwaStart().catch(e=>{console.error(e);$('criticalError').textContent='PWA konnte nicht gestartet werden: '+e.message;$('criticalError').classList.remove('hidden')})
})();

