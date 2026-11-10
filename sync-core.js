/* PMI-Wissensnavigator V011: deterministic editor-return inspection, no network, no silent mutation. */
(function(root, factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PMISync=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(plain(x)){const r={};for(const k of Object.keys(x).sort())r[k]=canonical(x[k]);return r;}return x;}
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const counts=w=>({nodes:w.payload.structure.nodes.length,edges:w.payload.structure.edges.length,annotations:Object.keys(w.payload.io.annotations).length});
function section(text,id){const lines=String(text??'').split(/\r?\n/),safe=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const find=new RegExp('^###\\s+'+safe+'\\s*(?:[–—-]|$)');const ix=[];lines.forEach((l,i)=>{if(find.test(l))ix.push(i)});if(ix.length!==1)return {ok:false,count:ix.length};let end=ix[0]+1;while(end<lines.length&&!/^###\s+FAQ-[A-Za-z0-9-]+\s*(?:[–—-]|$)/.test(lines[end]))end++;return {ok:true,raw:lines.slice(ix[0],end).join('\n').trim()};}
function problemsFor(w){const errors=[];if(!plain(w)||w.meta?.schema!=='vv4vis.v2'||w.meta?.workingSource?.schemaVersion!=='vv4.annotation-working-source.v1'||w.meta?.workingSource?.reportPackage!==false){errors.push('Fehlendes VV4-Annotations-Working-Source-Schema');return errors;}const nodes=w.payload?.structure?.nodes,edges=w.payload?.structure?.edges,ann=w.payload?.io?.annotations;if(!Array.isArray(nodes)||!Array.isArray(edges)||!plain(ann)){errors.push('Knoten, Kanten oder Annotationen fehlen');return errors;}const nk=new Set(),ek=new Set();for(const n of nodes){if(typeof n?.id!=='string'||!n.id||nk.has(n.id))errors.push('Node-ID ungültig: '+n?.id);nk.add(n.id);if(!n.meta?.templateRef?.key)errors.push('Knoten-Template fehlt: '+n.id)}for(const e of edges){if(typeof e?.id!=='string'||!e.id||ek.has(e.id))errors.push('Kanten-ID ungültig: '+e?.id);ek.add(e.id);if(!nk.has(e.from)||!nk.has(e.to))errors.push('Kanten-Endpunkt fehlt: '+e.id)}for(const id of Object.keys(ann)){if(!nk.has(id)&&!ek.has(id))errors.push('Verwaiste Annotation: '+id)}const key=w.meta.workingSource.documentKey;if(!key||w.meta?.documentRef?.key!==key)errors.push('Dokumentidentität im Rückexport ist inkonsistent');return errors;}
function dictById(arr){return new Map((arr||[]).map(x=>[x.id,x]));}
function diffItems(before,after,label,report){const bm=dictById(before),am=dictById(after);for(const [id,obj] of bm){if(!am.has(id)){report.blockers.push(label+' entfernt: '+id);report.differences[label].removed.push(id)}else if(!equal(obj,am.get(id)))report.differences[label].changed.push(id);}for(const [id]of am)if(!bm.has(id))report.differences[label].added.push(id);}
function diffAnnotations(before,after,report){const b=before.payload.io.annotations,a=after.payload.io.annotations;for(const [id,obj] of Object.entries(b)){
 if(!Object.prototype.hasOwnProperty.call(a,id)){report.blockers.push('Annotation fehlt: '+id);report.differences.annotations.removed.push(id);continue;}
 const v=a[id];if(!plain(v)){report.blockers.push('Annotation ungültig: '+id);continue;}
 for(const [key,old] of Object.entries(obj)){
  if(!Object.prototype.hasOwnProperty.call(v,key)){
   if(old!==null&&old!==''&&!(Array.isArray(old)&&old.length===0)&&!(plain(old)&&Object.keys(old).length===0))report.blockers.push('Nicht-leeres Annotationsfeld entfernt: '+id+'.'+key);
   else report.warnings.push('Leeres Annotationsfeld ausgelassen: '+id+'.'+key);
   report.differences.annotations.fieldsRemoved.push(id+'.'+key);
  }else if(!equal(old,v[key])){
   report.differences.annotations.fieldsChanged.push(id+'.'+key);
   if(['summary','runbook','user_docs','notes','title','links','labels'].includes(key))report.reviewRequired.push('Inhalt geändert: '+id+'.'+key);
   else report.warnings.push('Annotationsfeld geändert: '+id+'.'+key);
  }
 }
 for(const [key,val]of Object.entries(v))if(!Object.prototype.hasOwnProperty.call(obj,key)){
  if((key==='badges'&&equal(val,[]))||(key==='meta'&&equal(val,{manualLocks:{}}))){report.differences.annotations.editorDefaults++;}
  else {report.differences.annotations.fieldsAdded.push(id+'.'+key);report.reviewRequired.push('Neues Feld: '+id+'.'+key)}
 }
}
for(const id of Object.keys(a))if(!Object.prototype.hasOwnProperty.call(b,id))report.differences.annotations.added.push(id);
}
function analyze(bundle,incoming){
 const report={schema:'pmi.editor-sync.review.v1',version:'V011',status:'BLOCKED',documentKey:null,countsBefore:null,countsAfter:null,faqCount:0,anchorsChecked:0,anchorsValid:0,anchorsChanged:[],blockers:[],warnings:[],reviewRequired:[],observations:[],differences:{nodes:{removed:[],added:[],changed:[]},edges:{removed:[],added:[],changed:[]},annotations:{removed:[],added:[],fieldsRemoved:[],fieldsChanged:[],fieldsAdded:[],editorDefaults:0},meta:{lost:[],changed:[],added:[]}}};
 const b=bundle?.workingSource,w=incoming;if(!b||!bundle?.faqIndex||!bundle?.qaRegistry||!bundle?.evidenceRegistry){report.blockers.push('Viewer benötigt ein vollständiges Ausgangspaket mit FAQ-, Qualitäts- und Quellenregister');return report;}
 for(const s of problemsFor(w))report.blockers.push(s);if(report.blockers.length)return report;
 report.documentKey=w.meta.workingSource.documentKey;report.countsBefore=counts(b);report.countsAfter=counts(w);report.faqCount=bundle.faqIndex.entries?.length||0;
 const baseKey=bundle.faqIndex.workingSourceDocumentKey,refKey=b.meta?.workingSource?.documentKey;
 if(report.documentKey!==baseKey||refKey!==baseKey)report.blockers.push('Falscher documentKey (Rückexport gehört nicht zum FAQ-Index)');
 if(w.meta?.workingSource?.sourceScopeKey!==b.meta?.workingSource?.sourceScopeKey)report.blockers.push('Abweichender sourceScopeKey');
 if(w.meta?.workingSource?.profileKey!==b.meta?.workingSource?.profileKey)report.blockers.push('Abweichender profileKey');
 if(report.blockers.length)return report;
 diffItems(b.payload.structure.nodes,w.payload.structure.nodes,'nodes',report);
 diffItems(b.payload.structure.edges,w.payload.structure.edges,'edges',report);
 diffAnnotations(b,w,report);
 const be=b.meta,ae=w.meta;
 for(const k of Object.keys(be))if(!(k in ae))report.differences.meta.lost.push('meta.'+k);else if(!equal(be[k],ae[k]))report.differences.meta.changed.push('meta.'+k);
 for(const k of Object.keys(ae))if(!(k in be))report.differences.meta.added.push('meta.'+k);
 for(const k of Object.keys(be.workingSource||{}))if(!(k in (ae.workingSource||{})))report.differences.meta.lost.push('meta.workingSource.'+k);
 // The editor may normalize metadata. Preserve the original metadata in the viewer sidecar, do not rewrite editor export.
 if(report.differences.meta.lost.length)report.warnings.push('Editor hat '+report.differences.meta.lost.length+' Herkunfts-/Metadatenfelder nicht zurückgegeben; Original wird als Sidecar archiviert');
 if(report.differences.nodes.changed.length||report.differences.edges.changed.length||report.differences.nodes.added.length||report.differences.edges.added.length||report.differences.annotations.added.length){report.reviewRequired.push('Graphstruktur/Annotationenzahl verändert; vor Übernahme fachlich prüfen');}
 const ann=w.payload.io.annotations,ns=new Set(w.payload.structure.nodes.map(x=>x.id)),es=new Set(w.payload.structure.edges.map(x=>x.id));
 const faqEntries=bundle.faqIndex.entries;
 for(const f of faqEntries){for(const prop of ['primaryAnchor','technicalAnchor','reviewAnchor']){
  const a=f[prop];report.anchorsChecked++;if(!a||a.documentKey!==baseKey||a.sectionRef!==f.faqId||a.entityType!=='node'&&a.entityType!=='edge'||!(a.entityType==='node'?ns:es).has(a.entityId)||!ann[a.entityId]){report.blockers.push('FAQ-Anker fehlt/inkonsistent: '+f.faqId+'/'+prop);continue}
  const old=section(b.payload.io.annotations[a.entityId]?.[a.field],f.faqId),neu=section(ann[a.entityId]?.[a.field],f.faqId);
  if(!neu.ok){report.blockers.push('FAQ-Abschnitt fehlt oder mehrfach vorhanden: '+f.faqId+'/'+prop);continue}
  report.anchorsValid++;
  if(old.ok&&!equal(old.raw,neu.raw))report.anchorsChanged.push(f.faqId+'/'+prop);
 }
 for(const ref of f.relatedEntities||[])if(!(ref.entityType==='node'?ns:es).has(ref.entityId))report.blockers.push('FAQ-Referenz fehlt: '+f.faqId+'/'+ref.entityId);
 for(const ref of f.evidenceRefs||[])if(!(bundle.evidenceRegistry.entries||[]).some(e=>e.evidenceId===ref))report.blockers.push('Quellenbeleg fehlt im Sidecar: '+f.faqId+'/'+ref);
 if(f.qualityRef&&!bundle.qaRegistry.items.some(q=>q.qualityId===f.qualityRef))report.blockers.push('Qualitätseintrag fehlt im Sidecar: '+f.faqId);
 }
 if(report.anchorsChanged.length)report.reviewRequired.push('FAQ-Inhalte wurden geändert: '+[...new Set(report.anchorsChanged.map(s=>s.split('/')[0]))].join(', '));
 report.observations.push('FAQ-Index, QA-Register und Belegregister liegen nur im Viewer-Paket, nicht im VV4-Rückexport');
 report.observations.push('Laufende SQL-Speicherung, endgültige Freigabe und DocWiki-Handoff sind durch diesen lokalen Abgleich nicht nachgewiesen');
 report.blockers=[...new Set(report.blockers)];report.warnings=[...new Set(report.warnings)];report.reviewRequired=[...new Set(report.reviewRequired)];
 report.status=report.blockers.length?'BLOCKED':report.reviewRequired.length?'REVIEW_REQUIRED':'READY';return report;
}
function reconcile(bundle,incoming,report){if(!report||report.status==='BLOCKED'||report.blockers.length)throw Error('Übernahme blockiert: erst Probleme beheben');
 const next=clone(bundle);const original=clone(bundle.manifest?.preservedSourceWorkingSourceMeta||bundle.workingSource.meta);
 next.workingSource=clone(incoming);
 next.manifest={...next.manifest,viewerVersion:'V011',previousViewerVersion:bundle.manifest?.viewerVersion||'V009',label:'PMI Wissensanalyse – synchronisierter Viewer-Bestand (redaktioneller Entwurf)',editorImport:'USER_ROUNDTRIP_LOCAL_INSPECTION',syncStatus:report.status,syncRecordedAt:new Date().toISOString(),preservedSourceWorkingSourceMeta:original,editorSync:{schema:'pmi.editor-sync.sidecar.v1',documentKey:report.documentKey,faqCount:report.faqCount,anchorsChecked:report.anchorsChecked,anchorsValid:report.anchorsValid,anchorsChanged:report.anchorsChanged,countsBefore:report.countsBefore,countsAfter:report.countsAfter,status:report.status,editorDefaultFields:report.differences.annotations.editorDefaults,missingSourceMetaFields:report.differences.meta.lost,registries:['faqIndex','qaRegistry','evidenceRegistry'],limitations:['NO_SQL_READBACK','NO_DOCWIKI_RELEASE','EDITOR_RETURN_NOT_ALL_VIEWER_REGISTRIES']}};
 return next;
}
return {analyze,reconcile,section,canonical,equal,problemsFor};
});
