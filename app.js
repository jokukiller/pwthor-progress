const shape={root:['schemaVersion','scope','generatedAt','serviceState','batches','data','performance','proxies','backup'],batches:['total','complete','remaining','blockedJobs'],data:['assets','placements','completedSubjects'],performance:['productiveRps30s','productiveRpsAverage','commitsPerSecond'],proxies:['candidates','qualifiedAvailable','active','activeTransports','qualifying'],backup:['status','verifiedAt','uploadedAt','captureStartedAt','mode','destinations']};
const exact=(x,keys)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join('|')!==[...keys].sort().join('|'))throw Error('Unexpected public status fields');};
export function sanitizeStatus(input){
  input=structuredClone(input);
  if(input?.proxies&&!Object.hasOwn(input.proxies,'activeTransports'))input.proxies.activeTransports=input.proxies.active;
  if(input?.backup){input.backup.mode??='legacy-verification';input.backup.uploadedAt??=null;input.backup.captureStartedAt??=null;}
  exact(input,shape.root);if(input.schemaVersion!==1||input.scope!=='video-metadata')throw Error('Wrong status scope');
  if(!Number.isFinite(Date.parse(input.generatedAt))||!['active','inactive','failed','unknown'].includes(input.serviceState))throw Error('Invalid runtime status');
  for(const key of ['batches','data','performance','proxies']){exact(input[key],shape[key]);for(const value of Object.values(input[key]))if(!Number.isFinite(value)||value<0||value>1e12)throw Error('Invalid status count');}
  if(input.batches.complete+input.batches.remaining!==input.batches.total)throw Error('Batch counts do not reconcile');
  exact(input.backup,shape.backup);if(!['healthy','stale','unknown','failed'].includes(input.backup.status)||!Number.isSafeInteger(input.backup.destinations)||input.backup.destinations<0||input.backup.destinations>16||input.backup.verifiedAt!==null&&!Number.isFinite(Date.parse(input.backup.verifiedAt)))throw Error('Invalid backup status');
  if(!['legacy-verification','upload-acknowledged'].includes(input.backup.mode)||['uploadedAt','captureStartedAt'].some(k=>input.backup[k]!==null&&!Number.isFinite(Date.parse(input.backup[k])))||input.backup.mode==='upload-acknowledged'&&input.backup.verifiedAt!==null)throw Error('Invalid backup method');
  if(input.backup.mode==='upload-acknowledged'&&input.backup.status==='healthy'&&(!input.backup.uploadedAt||!input.backup.captureStartedAt))throw Error('Missing upload timestamps');
  return structuredClone(input);
}
export function emptyDocumentStatus(generatedAt){return {schemaVersion:1,scope:'document-metadata',generatedAt,enabled:false,available:true,admissionMode:'disabled',admittedBatches:0,records:0,placements:0,completedBatches:0,totalBatches:0,completedSubjectChannels:0,attachmentReferences:0,unresolvedAttachmentReferences:0,blockedJobs:0,activeJobs:0,productiveRps30s:0,archiveState:'not-transferred'};}
export function sanitizeDocumentStatus(input){
  const template=emptyDocumentStatus(input?.generatedAt);exact(input,Object.keys(template));
  if(input.schemaVersion!==1||input.scope!=='document-metadata'||!Number.isFinite(Date.parse(input.generatedAt))||typeof input.enabled!=='boolean'||typeof input.available!=='boolean'||!['disabled','canary','full'].includes(input.admissionMode)||input.archiveState!=='not-transferred')throw Error('Invalid document status');
  for(const key of ['records','placements','completedBatches','totalBatches','admittedBatches','completedSubjectChannels','attachmentReferences','unresolvedAttachmentReferences','blockedJobs','activeJobs','productiveRps30s'])if(!Number.isFinite(input[key])||input[key]<0||input[key]>1e12)throw Error('Invalid document count');
  return structuredClone(input);
}
if(typeof document!=='undefined'){
  const number=new Intl.NumberFormat(undefined,{maximumFractionDigits:2}),set=(id,value)=>{document.getElementById(id).textContent=value;};
  async function refresh(){try{
    const response=await fetch(`status.json?t=${Date.now()}`,{cache:'no-store'});if(!response.ok)throw Error('Status unavailable');const s=sanitizeStatus(await response.json());
    const stale=Date.now()-Date.parse(s.generatedAt)>900000;
    set('state',stale?'Stale update':s.serviceState==='active'?'Collecting':s.serviceState==='failed'?'Needs attention':'Stopped');
    set('batch',`${number.format(s.batches.complete)} / ${number.format(s.batches.total)}`);
    document.getElementById('progress').value=s.batches.total?s.batches.complete/s.batches.total*100:0;
    set('remaining',`${number.format(s.batches.remaining)} batches unfinished · ${number.format(s.batches.blockedJobs)} jobs need review`);
    set('rps',number.format(s.performance.productiveRps30s));set('average',`${number.format(s.performance.productiveRpsAverage)} RPS averaged over this run`);
    set('assets',number.format(s.data.assets));set('placements',`${number.format(s.data.placements)} placements · ${number.format(s.data.completedSubjects)} complete subjects`);
    set('lanes',number.format(s.proxies.active));set('qualified',`${number.format(s.proxies.activeTransports)} proxies carrying these jobs · ${number.format(s.proxies.qualifiedAvailable)} qualified endpoints available`);
    set('candidates',`${number.format(s.proxies.candidates)} candidates · ${number.format(s.proxies.qualifying)} being qualified`);
    set('backup',s.backup.mode==='upload-acknowledged'?`${s.backup.status} · archive upload`:`${s.backup.status} · ${s.backup.destinations} destinations`);
    set('backup-time',s.backup.mode==='upload-acknowledged'?(s.backup.uploadedAt?`Uploaded ${new Date(s.backup.uploadedAt).toLocaleString()} · captured ${new Date(s.backup.captureStartedAt).toLocaleString()}`:'Awaiting first upload'):(s.backup.verifiedAt?new Date(s.backup.verifiedAt).toLocaleString():'Awaiting verification'));
    set('updated',new Date(s.generatedAt).toLocaleString());
    try{const response=await fetch(`documents.json?t=${Date.now()}`,{cache:'no-store'});if(!response.ok)throw Error();const d=sanitizeDocumentStatus(await response.json());
      set('documents',!d.available?'Unavailable':!d.enabled?'Not started':number.format(d.records));
      set('document-detail',!d.available?'Document status is unavailable.':d.enabled?`${number.format(d.attachmentReferences)} attachment references · ${number.format(d.completedBatches)} / ${number.format(d.admittedBatches)} admitted batches complete · ${d.admissionMode==='canary'?'Canary scope':'Full batch scope'}`:'Independent notes and DPP PDF collection.');
      set('document-performance',d.enabled?`${number.format(d.unresolvedAttachmentReferences)} references awaiting address resolution · ${number.format(d.activeJobs)} active jobs · ${number.format(d.productiveRps30s)} productive RPS · ${number.format(d.blockedJobs)} jobs need review`:'');
    }catch{set('documents','Awaiting status');}
  }catch{set('state','Unable to refresh');}}
  refresh();setInterval(refresh,30000);
}
