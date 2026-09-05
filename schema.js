const LIMIT=1e12;
const DATASET_IDS=Object.freeze(['videos','documents','DppVideos','programmes','tests','DppQuiz','announcements']);
const DATASET_STATES=new Set(['active','queued','waiting','blocked','complete','unknown']);
const DISCOVERY_STATES=new Set(['complete','growing','incomplete','unknown']);
const RUNTIME_STATES=new Set(['active','inactive','failed','unknown']);
const RUNTIME_PHASES=new Set(['collecting','recovering','paused','stopped','attention','unknown']);
const BACKUP_STATUSES=new Set(['healthy','stale','failed','unknown']);
const BACKUP_PHASES=new Set(['running','complete','failed','unknown']);
const UPDATE_IDS=new Set(['dpp-page-policy','fresh-question-priority','remaining-dashboard','queue-integrity-recovery']);
const UPDATE_STATES=new Set(['testing','deployed','investigating','paused']);
const JOB_KEYS=['total','complete','pending','active','blocked','remaining','ready'];
const COUNT_KEYS=['records','placements','metadata','papers','questions','batchesComplete','batchesTotal','subjectsComplete','subjectsTotal','topicsDiscovered','topicListsComplete','emptyTopics','attachmentReferences','unresolvedReferences','deferredBodyReferences','totalSubjectiveFilterBatches','completedSubjectiveFilterBatches','completedSubjectiveLists','subjectivePlacements','subjectiveTestsDiscovered'];
const SUBJECTIVE_COUNT_KEYS=['totalSubjectiveFilterBatches','completedSubjectiveFilterBatches','completedSubjectiveLists','subjectivePlacements','subjectiveTestsDiscovered'];

const exact=(x,keys)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join('|')!==[...keys].sort().join('|'))throw Error('Unexpected public status fields');};
const finite=(value,{integer=false,nullable=false}={})=>{if(nullable&&value===null)return;if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>LIMIT||(integer&&!Number.isSafeInteger(value)))throw Error('Invalid public aggregate');};
const iso=(value,{nullable=false}={})=>{if(nullable&&value===null)return;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error('Invalid public timestamp');};
const uniqueExactIds=(items,ids)=>{if(!Array.isArray(items)||items.length!==ids.length||new Set(items.map(item=>item?.id)).size!==ids.length||items.map(item=>item?.id).sort().join('|')!==[...ids].sort().join('|'))throw Error('Invalid public namespace');};

// The legacy endpoints are deliberately retained for old consumers.
const shape={root:['schemaVersion','scope','generatedAt','serviceState','batches','data','performance','proxies','backup'],batches:['total','complete','remaining','blockedJobs'],data:['assets','placements','completedSubjects'],performance:['productiveRps30s','productiveRpsAverage','commitsPerSecond'],proxies:['candidates','qualifiedAvailable','active','activeTransports','qualifying'],backup:['status','verifiedAt','uploadedAt','captureStartedAt','mode','destinations']};
export function sanitizeStatus(input){
  input=structuredClone(input);if(input?.proxies&&!Object.hasOwn(input.proxies,'activeTransports'))input.proxies.activeTransports=input.proxies.active;if(input?.backup){input.backup.mode??='legacy-verification';input.backup.uploadedAt??=null;input.backup.captureStartedAt??=null;}
  exact(input,shape.root);if(input.schemaVersion!==1||input.scope!=='video-metadata')throw Error('Wrong status scope');if(!Number.isFinite(Date.parse(input.generatedAt))||!['active','inactive','failed','unknown'].includes(input.serviceState))throw Error('Invalid runtime status');
  for(const key of ['batches','data','performance','proxies']){exact(input[key],shape[key]);for(const value of Object.values(input[key]))if(!Number.isFinite(value)||value<0||value>LIMIT)throw Error('Invalid status count');}if(input.batches.complete+input.batches.remaining!==input.batches.total)throw Error('Batch counts do not reconcile');
  exact(input.backup,shape.backup);if(!['healthy','stale','unknown','failed'].includes(input.backup.status)||!Number.isSafeInteger(input.backup.destinations)||input.backup.destinations<0||input.backup.destinations>16||input.backup.verifiedAt!==null&&!Number.isFinite(Date.parse(input.backup.verifiedAt)))throw Error('Invalid backup status');if(!['legacy-verification','upload-acknowledged'].includes(input.backup.mode)||['uploadedAt','captureStartedAt'].some(k=>input.backup[k]!==null&&!Number.isFinite(Date.parse(input.backup[k])))||input.backup.mode==='upload-acknowledged'&&input.backup.verifiedAt!==null)throw Error('Invalid backup method');if(input.backup.mode==='upload-acknowledged'&&input.backup.status==='healthy'&&(!input.backup.uploadedAt||!input.backup.captureStartedAt))throw Error('Missing upload timestamps');return structuredClone(input);
}
export function emptyDocumentStatus(generatedAt){return {schemaVersion:1,scope:'document-metadata',generatedAt,enabled:false,available:true,admissionMode:'disabled',admittedBatches:0,records:0,placements:0,completedBatches:0,totalBatches:0,completedSubjectChannels:0,attachmentReferences:0,unresolvedAttachmentReferences:0,blockedJobs:0,activeJobs:0,productiveRps30s:0,archiveState:'not-transferred'};}
export function sanitizeDocumentStatus(input){const template=emptyDocumentStatus(input?.generatedAt);exact(input,Object.keys(template));if(input.schemaVersion!==1||input.scope!=='document-metadata'||!Number.isFinite(Date.parse(input.generatedAt))||typeof input.enabled!=='boolean'||typeof input.available!=='boolean'||!['disabled','canary','full'].includes(input.admissionMode)||input.archiveState!=='not-transferred')throw Error('Invalid document status');for(const key of ['records','placements','completedBatches','totalBatches','admittedBatches','completedSubjectChannels','attachmentReferences','unresolvedAttachmentReferences','blockedJobs','activeJobs','productiveRps30s'])if(!Number.isFinite(input[key])||input[key]<0||input[key]>LIMIT)throw Error('Invalid document count');return structuredClone(input);}

function normalizeOptionalSubjectiveCounts(input){
  if(!Array.isArray(input.datasets))return;
  for(const dataset of input.datasets??[]){
    if(!dataset?.counts||typeof dataset.counts!=='object'||Array.isArray(dataset.counts))continue;
    const legacyMissing=SUBJECTIVE_COUNT_KEYS.some(key=>!Object.hasOwn(dataset.counts,key));
    for(const key of SUBJECTIVE_COUNT_KEYS)if(!Object.hasOwn(dataset.counts,key))dataset.counts[key]=null;
    // Old v8 payloads had no subjective projection. Keep them renderable, but
    // prevent objective completion from being presented as full discovery.
    if(dataset.id==='tests'&&legacyMissing&&dataset.discovery==='complete'){
      dataset.discovery='incomplete';
      if(dataset.state==='complete')dataset.state='queued';
    }
  }
}
function validateDataset(dataset){
  exact(dataset,['id','available','state','discovery','jobs','counts','productiveRps30s','issues','nextRetryAt']);if(!DATASET_IDS.includes(dataset.id)||typeof dataset.available!=='boolean'||!DATASET_STATES.has(dataset.state)||!DISCOVERY_STATES.has(dataset.discovery))throw Error('Invalid dataset status');exact(dataset.jobs,JOB_KEYS);exact(dataset.counts,COUNT_KEYS);for(const key of JOB_KEYS)finite(dataset.jobs[key],{integer:true,nullable:true});for(const key of COUNT_KEYS)finite(dataset.counts[key],{integer:true,nullable:true});finite(dataset.productiveRps30s,{nullable:true});iso(dataset.nextRetryAt,{nullable:true});
  if(!Array.isArray(dataset.issues)||new Set(dataset.issues.map(issue=>issue?.code)).size!==dataset.issues.length)throw Error('Invalid public issues');for(const issue of dataset.issues){exact(issue,['code','count']);if(typeof issue.code!=='string'||!/^[A-Z][A-Z0-9_]{0,47}$/.test(issue.code))throw Error('Invalid issue code');finite(issue.count,{integer:true});}
  const j=dataset.jobs,core=['total','complete','pending','active','blocked','remaining'];
  if(!dataset.available&& (dataset.state!=='unknown'||dataset.discovery!=='unknown'||JOB_KEYS.some(key=>j[key]!==null)))throw Error('Missing dataset must stay unknown');
  if(dataset.available){
    if(core.some(key=>j[key]===null)||j.total!==j.complete+j.pending+j.active+j.blocked||j.remaining!==j.pending+j.active+j.blocked)throw Error('Dataset jobs do not reconcile');
    if(dataset.state==='complete'&&(j.remaining!==0||dataset.discovery!=='complete'||(dataset.counts.unresolvedReferences!==null&&dataset.counts.unresolvedReferences!==0)))throw Error('Dataset cannot be complete');
    if(dataset.id==='tests'){
      const c=dataset.counts,enrolled=c.totalSubjectiveFilterBatches,completed=c.completedSubjectiveFilterBatches,fullPlan=c.batchesTotal;
      if([enrolled,completed,fullPlan].every(value=>value!==null)&&(completed>enrolled||enrolled>fullPlan))throw Error('Subjective filter counts do not reconcile');
      if([c.subjectiveTestsDiscovered,c.subjectivePlacements,c.placements].every(value=>value!==null)&&(c.subjectiveTestsDiscovered>c.subjectivePlacements||c.subjectivePlacements>c.placements))throw Error('Subjective placement counts do not reconcile');
      if(dataset.discovery==='complete'&&(SUBJECTIVE_COUNT_KEYS.some(key=>c[key]===null)||enrolled<=0||completed!==enrolled||enrolled!==fullPlan))throw Error('Subjective discovery is not complete');
    }
  }
}
function validateHistorySample(sample){exact(sample,['at','phase','productiveRps30s','datasets']);iso(sample.at);if(!RUNTIME_PHASES.has(sample.phase))throw Error('Invalid history phase');finite(sample.productiveRps30s,{nullable:true});uniqueExactIds(sample.datasets,DATASET_IDS);for(const dataset of sample.datasets){exact(dataset,['id','completeJobs','remainingJobs','records','metadata','papers']);for(const key of ['completeJobs','remainingJobs','records','metadata','papers'])finite(dataset[key],{integer:true,nullable:true});}}

/** Validate the v2 public remaining-work payload and clone it. */
export function sanitizeWorkStatus(input){
  input=structuredClone(input);exact(input,['schemaVersion','scope','generatedAt','runtime','summary','datasets','coverage','backup','milestones','updates','history']);if(input.schemaVersion!==2||input.scope!=='all-metadata')throw Error('Wrong work status scope');iso(input.generatedAt);normalizeOptionalSubjectiveCounts(input);
  exact(input.runtime,['state','phase','version','startedAt','progressAt','activeJobs','activeTransports','qualifiedTransports','questionTransports','productiveRps30s','sourcePauseUntil']);if(!RUNTIME_STATES.has(input.runtime.state)||!RUNTIME_PHASES.has(input.runtime.phase)||(input.runtime.version!==null&&(typeof input.runtime.version!=='string'||!/^v[0-9]+$/.test(input.runtime.version))))throw Error('Invalid work runtime');for(const key of ['startedAt','progressAt','sourcePauseUntil'])iso(input.runtime[key],{nullable:true});for(const key of ['activeJobs','activeTransports','qualifiedTransports','questionTransports'])finite(input.runtime[key],{integer:true,nullable:true});finite(input.runtime.productiveRps30s,{nullable:true});if(input.runtime.phase!=='collecting'&&input.runtime.productiveRps30s!==null)throw Error('Inactive runtime cannot report live throughput');
  exact(input.summary,['knownRemainingJobs','pendingJobs','activeJobs','blockedJobs','availableDatasets','missingDatasets']);for(const value of Object.values(input.summary))finite(value,{integer:true});uniqueExactIds(input.datasets,DATASET_IDS);for(const dataset of input.datasets)validateDataset(dataset);if(input.runtime.phase!=='collecting'&&input.datasets.some(dataset=>dataset.productiveRps30s!==null))throw Error('Inactive runtime cannot report dataset throughput');const known=input.datasets.filter(dataset=>dataset.jobs.remaining!==null);const sums={knownRemainingJobs:known.reduce((n,d)=>n+d.jobs.remaining,0),pendingJobs:known.reduce((n,d)=>n+d.jobs.pending,0),activeJobs:known.reduce((n,d)=>n+d.jobs.active,0),blockedJobs:known.reduce((n,d)=>n+d.jobs.blocked,0),availableDatasets:input.datasets.filter(d=>d.available).length,missingDatasets:input.datasets.filter(d=>!d.available).length};if(Object.entries(sums).some(([key,value])=>input.summary[key]!==value))throw Error('Summary does not reconcile');
  uniqueExactIds(input.coverage,['subjective-tests','separate-test-site']);for(const item of input.coverage){exact(item,['id','state']);if(item.state!=='unvalidated')throw Error('Coverage cannot be inferred');}exact(input.backup,['status','phase','capturedAt','uploadedAt']);if(!BACKUP_STATUSES.has(input.backup.status)||!BACKUP_PHASES.has(input.backup.phase))throw Error('Invalid work backup');iso(input.backup.capturedAt,{nullable:true});iso(input.backup.uploadedAt,{nullable:true});exact(input.milestones,['collection','finalArchive','shutdown']);if(!['in-progress','complete'].includes(input.milestones.collection)||!['pending','complete'].includes(input.milestones.finalArchive)||!['pending','complete'].includes(input.milestones.shutdown))throw Error('Invalid milestones');
  exact(input.updates,['at','items']);iso(input.updates.at,{nullable:true});if(!Array.isArray(input.updates.items)||new Set(input.updates.items.map(item=>item?.id)).size!==input.updates.items.length)throw Error('Invalid updates');for(const item of input.updates.items){exact(item,['id','state']);if(!UPDATE_IDS.has(item.id)||!UPDATE_STATES.has(item.state))throw Error('Invalid update');}if(!Array.isArray(input.history)||input.history.length>145)throw Error('Invalid history');let previousAt=-Infinity;const generatedAt=Date.parse(input.generatedAt);for(const sample of input.history){validateHistorySample(sample);const at=Date.parse(sample.at);if(at>generatedAt||at<=previousAt)throw Error('History must be chronological');previousAt=at;}if(input.history.length){const newest=Date.parse(input.history.at(-1).at),cutoff=newest-86_400_000;if(input.history.filter(sample=>Date.parse(sample.at)<cutoff).length>1)throw Error('History retention exceeded');}return structuredClone(input);
}
