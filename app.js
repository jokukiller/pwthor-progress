import {sanitizeWorkStatus} from './schema.js?v=61ada27513712718';
export {sanitizeStatus, emptyDocumentStatus, sanitizeDocumentStatus} from './schema.js?v=61ada27513712718';

const DATASETS = [
  {id:'documents', name:'Notes & DPP PDFs', description:'Document metadata and references'},
  {id:'DppVideos', name:'DPP videos', description:'Schedules and placements'},
  {id:'programmes', name:'Programmes', description:'Programme topics and records'},
  {id:'tests', name:'Tests', description:'Metadata, papers, and questions'},
  {id:'DppQuiz', name:'DPP quizzes', description:'Subjects, topics, papers, questions'},
  {id:'announcements', name:'Announcements', description:'Batches, records, and references'}
];

const LABELS = {
  states:{active:'Active', queued:'Queued', waiting:'Waiting', blocked:'Blocked', complete:'Complete', unknown:'Unknown'},
  phases:{collecting:'Collecting', recovering:'Recovering', paused:'Paused', stopped:'Stopped', attention:'Needs attention', unknown:'Unknown'},
  coverage:{'subjective-tests':'Subjective tests', 'separate-test-site':'Separate test site'},
  updates:{'dpp-page-policy':'DPP page policy', 'fresh-question-priority':'Fresh question priority', 'remaining-dashboard':'Remaining-work dashboard','queue-integrity-recovery':'Queue-index recovery'},
  issues:{
    HTTP_404:'Source not found',
    TEST_QUESTION_COUNT_MISMATCH:'Count differs from source',
    IMPORT_COUNT_MISMATCH:'Count differs from source',
    PROGRAMME_SUBJECT_DISCOVERY_UNRESOLVED:'Programme discovery unresolved',
    LIBRARY_PAGINATION_DUPLICATE:'Overlapping library pages',
    LIBRARY_PAGINATION_OVERLAP:'Overlapping library pages',
    TEST_SOURCE_REVISION_CHANGED:'Source revision changed',
    SOURCE_REVISION_CHANGED:'Source revision changed',
    OTHER:'Other source issue'
  }
};
const UPDATE_DETAILS={
  'queue-integrity-recovery':{
    investigating:'Queue-index recovery is under investigation; original database copies are preserved; no ETA is published.',
    paused:'Collector is paused for queue-index recovery; original database copies are preserved; no ETA is published.',
    testing:'Repaired queue-index candidates are being checked; collector remains paused. Original database copies are preserved; no ETA is published.',
    deployed:'Queue indexes are repaired, warm-up isolation is fixed, and collection has resumed. No ETA is published.'
  }
};

const numberFormat = new Intl.NumberFormat(undefined, {maximumFractionDigits:2});
const integerFormat = new Intl.NumberFormat(undefined, {maximumFractionDigits:0});
const dateFormat = new Intl.DateTimeFormat(undefined, {dateStyle:'medium', timeStyle:'short'});
const relativeFormat = new Intl.RelativeTimeFormat(undefined, {numeric:'auto'});
let currentFilter = 'remaining';
let lastGood = null;

const byId = id => document.getElementById(id);
const setText = (id, value) => { const node=byId(id); if(node) node.textContent=value; };
const isKnown = value => value !== null && value !== undefined;
const formatCount = value => isKnown(value) ? integerFormat.format(value) : 'Unknown';
const formatRate = value => isKnown(value) ? numberFormat.format(value) : 'Unknown';
const formatTracked = value => isKnown(value) ? integerFormat.format(value) : 'Not tracked';
const titleCase = value => value ? value.replaceAll('-', ' ').replace(/\b\w/g, letter=>letter.toUpperCase()) : 'Unknown';

function relativeAge(timestamp, now=Date.now()) {
  if(!timestamp) return 'Unknown';
  const milliseconds = Date.parse(timestamp);
  if(!Number.isFinite(milliseconds)) return 'Unknown';
  const delta = milliseconds-now;
  const absolute = Math.abs(delta);
  if(absolute < 60000) return 'just now';
  if(absolute < 3600000) return relativeFormat.format(Math.round(delta/60000), 'minute');
  if(absolute < 86400000) return relativeFormat.format(Math.round(delta/3600000), 'hour');
  return relativeFormat.format(Math.round(delta/86400000), 'day');
}

function setTime(id, timestamp) {
  const node=byId(id);
  if(!node) return;
  node.dateTime=timestamp || '';
  node.textContent=timestamp ? relativeAge(timestamp) : 'unknown';
  node.title=timestamp ? dateFormat.format(new Date(timestamp)) : 'No timestamp published';
}

function toneForState(state) {
  if(state==='active'||state==='complete') return 'good';
  if(state==='queued'||state==='waiting') return 'warn';
  if(state==='blocked') return 'bad';
  return 'neutral';
}

function element(tag, className, text) {
  const node=document.createElement(tag);
  if(className) node.className=className;
  if(text!==undefined) node.textContent=text;
  return node;
}

function detailValue(label, value) {
  const wrapper=element('div','detail-stat');
  wrapper.append(element('span','',label), element('strong','',value));
  return wrapper;
}

function fraction(complete,total) {
  if(!isKnown(complete)&&!isKnown(total)) return null;
  return `${formatCount(complete)} / ${formatCount(total)}`;
}
function trackedFraction(complete,total) {
  if(!isKnown(complete)&&!isKnown(total)) return 'Not tracked';
  return `${formatTracked(complete)} / ${formatTracked(total)}`;
}

function datasetDetails(dataset) {
  const values=[];
  const add=(label,value)=>{ if(isKnown(value)) values.push([label,typeof value==='string'?value:formatCount(value)]); };
  const c=dataset.counts;
  if(dataset.id==='documents') {
    add('Records',c.records); add('Placements',c.placements); add('Attachment refs',c.attachmentReferences); add('Unresolved refs',c.unresolvedReferences);
  } else if(dataset.id==='DppVideos') {
    add('Schedules',c.records); add('Placements',c.placements);
  } else if(dataset.id==='programmes') {
    add('Records',c.records); add('Topics found',c.topicsDiscovered); add('Topic lists done',c.topicListsComplete);
  } else if(dataset.id==='tests') {
    add('Test metadata captured',c.metadata); add('Papers captured',c.papers); add('Questions captured',c.questions); add('Placements',c.placements); add('Objective filter batches',fraction(c.batchesComplete,c.batchesTotal)); add('Subjective filters seeded',trackedFraction(c.totalSubjectiveFilterBatches,c.batchesTotal)); add('Subjective filters completed',trackedFraction(c.completedSubjectiveFilterBatches,c.batchesTotal)); add('Subjective lists captured',c.completedSubjectiveLists); add('Subjective placements',c.subjectivePlacements); add('Subjective tests discovered',c.subjectiveTestsDiscovered);
  } else if(dataset.id==='DppQuiz') {
    add('Quiz metadata captured',c.metadata); add('Papers captured',c.papers); add('Questions captured',c.questions); add('Subjects',fraction(c.subjectsComplete,c.subjectsTotal)); add('Topics found',c.topicsDiscovered); add('Topic lists done',c.topicListsComplete); add('Advertised empty',c.emptyTopics);
  } else if(dataset.id==='announcements') {
    add('Records',c.records); add('Batches',fraction(c.batchesComplete,c.batchesTotal)); add('Attachment refs',c.attachmentReferences); add('Unresolved refs',c.unresolvedReferences); add('Deferred body refs',c.deferredBodyReferences);
  }
  add('Queue total',dataset.jobs.total);
  add('Complete jobs',dataset.jobs.complete);
  if(isKnown(dataset.productiveRps30s)) values.push(['Queue RPS',formatRate(dataset.productiveRps30s)]);
  values.push(['Discovery',titleCase(dataset.discovery)]);
  return values;
}

function stageSummary(dataset) {
  const c=dataset.counts;
  const discovery=dataset.discovery==='growing'?'Discovery is still growing. ':dataset.discovery==='incomplete'?'Discovery is incomplete. ':dataset.discovery==='unknown'?'Discovery extent is unknown. ':'';
  let stages='Stage counts unavailable.';
  if(dataset.id==='documents') stages=`${formatCount(c.records)} records captured · ${formatCount(c.unresolvedReferences)} references unresolved`;
  else if(dataset.id==='DppVideos') stages=`${formatCount(c.records)} schedules · ${formatCount(c.placements)} placements`;
  else if(dataset.id==='programmes') stages=`${formatCount(c.topicsDiscovered)} topics discovered · ${formatCount(c.topicListsComplete)} topic lists complete`;
  else if(dataset.id==='tests') stages=`${formatCount(c.metadata)} test metadata captured · ${formatCount(c.papers)} papers captured · objective filters ${fraction(c.batchesComplete,c.batchesTotal)||'Unknown'} · subjective filters ${trackedFraction(c.completedSubjectiveFilterBatches,c.batchesTotal)} complete`;
  else if(dataset.id==='DppQuiz') stages=`${fraction(c.subjectsComplete,c.subjectsTotal)||'Unknown'} subject discovery jobs complete · ${formatCount(c.papers)} papers captured`;
  else if(dataset.id==='announcements') stages=`${fraction(c.batchesComplete,c.batchesTotal)||'Unknown'} batches complete · ${formatCount(c.records)} records captured`;
  return discovery+stages;
}

function issueLabel(code) {
  if(LABELS.issues[code]) return LABELS.issues[code];
  if(code.endsWith('_COUNT_MISMATCH')) return 'Count differs from source';
  if(code.includes('PROGRAMME')&&code.includes('DISCOVERY')&&code.includes('UNRESOLVED')) return 'Programme discovery unresolved';
  if(code.includes('LIBRARY')&&(code.includes('PAGINATION_DUPLICATE')||code.includes('PAGE_OVERLAP'))) return 'Overlapping library pages';
  if(code.endsWith('_SOURCE_REVISION_CHANGED')) return 'Source revision changed';
  return 'Source issue needs review';
}

function readiness(dataset) {
  if(!dataset.available) return {className:'', text:'Status for this queue was not available in the publication.'};
  if(isKnown(dataset.jobs.active)&&dataset.jobs.active>0) {
    const ready=isKnown(dataset.jobs.ready)?dataset.jobs.ready:null;
    const suffix=ready===null?'ready-job sample unavailable':ready>0?`${formatCount(ready)} more ready`:'no additional jobs observed ready';
    return {className:'is-ready',text:`${formatCount(dataset.jobs.active)} active now · ${suffix}`};
  }
  if(isKnown(dataset.jobs.ready)&&dataset.jobs.ready>0) return {className:'is-ready', text:`${formatCount(dataset.jobs.ready)} ready now`};
  if(dataset.nextRetryAt) {
    const due=Date.parse(dataset.nextRetryAt)<=Date.now();
    return {className:'is-waiting', text:due?'Retry is due · awaiting a newer sample':`Timed wait · next retry ${relativeAge(dataset.nextRetryAt)}`};
  }
  if(dataset.state==='waiting') return {className:'is-waiting', text:'Waiting on source · retry time unknown'};
  if(dataset.state==='blocked') return {className:'is-waiting', text:'Review required before this queue can move'};
  if(dataset.state==='complete') return {className:'is-ready', text:'No known jobs remain in this queue'};
  if(isKnown(dataset.jobs.ready)) return {className:'', text:'No jobs observed ready at the latest sample'};
  return {className:'', text:'Ready-job sample unavailable'};
}

function shouldShow(dataset) {
  if(currentFilter==='all') return true;
  if(!dataset.available) return true;
  return dataset.state!=='complete' || (isKnown(dataset.jobs.remaining)&&dataset.jobs.remaining>0);
}

function buildQueueCard(meta, dataset, index, expanded) {
  const card=element('article',`queue-card${dataset.available?'':' is-missing'}`);
  card.dataset.state=dataset.state;
  card.dataset.datasetId=dataset.id;
  card.hidden=!shouldShow(dataset);
  const main=element('div','card-main');
  const header=element('div','card-header');
  const nameWrap=element('div','dataset-name');
  const nameCopy=element('div');
  nameCopy.append(element('h3','',meta.name),element('p','',meta.description));
  nameWrap.append(element('span','dataset-index',String(index+1).padStart(2,'0')),nameCopy);
  const state=element('span','state-pill',dataset.available ? (LABELS.states[dataset.state]||titleCase(dataset.state)) : 'Unavailable');
  state.dataset.tone=dataset.available ? toneForState(dataset.state) : 'neutral';
  header.append(nameWrap,state);
  const counts=element('div','queue-counts');
  const fields=[['Remaining',dataset.jobs.remaining,'remaining-value'],['Active',dataset.jobs.active,''],['Blocked',dataset.jobs.blocked,'']];
  for(const [label,value,className] of fields) {
    const wrapper=element('div');
    wrapper.append(element('span','',label),element('strong',className,formatCount(value)));
    counts.append(wrapper);
  }
  const stage=element('p','stage-summary',stageSummary(dataset));
  if(dataset.discovery==='growing'||dataset.discovery==='incomplete') stage.dataset.discovery=dataset.discovery;
  const ready=readiness(dataset);
  const availability=element('p',`availability ${ready.className}`.trim());
  availability.append(element('span','availability-dot'),document.createTextNode(ready.text));
  main.append(header,counts,stage,availability);
  const details=element('details','card-details');
  details.open=expanded;
  details.append(element('summary','','Queue and stage details'));
  const body=element('div','details-body');
  const detailGrid=element('div','detail-grid');
  for(const [label,value] of datasetDetails(dataset)) detailGrid.append(detailValue(label,value));
  body.append(detailGrid);
  if(dataset.id==='tests'&&isKnown(dataset.counts.subjectiveTestsDiscovered)&&dataset.counts.subjectiveTestsDiscovered>0)
    body.append(element('p','operator-note','2026-09-14 source audit: subjective catalogue and instructions were available for the observed scope; observed source-labelled cache status left main uncached paper retrieval unproven. This does not establish a universal source outage.'));
  if(dataset.issues.length) {
    body.append(element('p','issues-label','Published source issues'));
    const issues=element('ul','issues');
    for(const issue of dataset.issues) {
      const item=element('li');
      const description=element('span','issue-description');
      description.append(element('strong','',issueLabel(issue.code)),element('code','',issue.code));
      item.append(description,element('strong','issue-count',formatCount(issue.count)));
      issues.append(item);
    }
    body.append(issues);
  }
  details.append(body);
  card.append(main,details);
  return card;
}

function renderQueues(status) {
  const container=byId('queue-grid');
  const expanded=new Set([...container.querySelectorAll('.queue-card details[open]')].map(details=>details.closest('.queue-card')?.dataset.datasetId).filter(Boolean));
  container.replaceChildren();
  const map=new Map(status.datasets.map(dataset=>[dataset.id,dataset]));
  const entries=DATASETS.map(meta=>({meta,dataset:map.get(meta.id)})).sort((left,right)=>{
    const group=dataset=>!dataset.available||!isKnown(dataset.jobs.remaining)?1:dataset.state==='complete'?2:0;
    const groupDifference=group(left.dataset)-group(right.dataset);
    if(groupDifference) return groupDifference;
    const leftRemaining=left.dataset.jobs.remaining;
    const rightRemaining=right.dataset.jobs.remaining;
    if(isKnown(leftRemaining)&&isKnown(rightRemaining)&&leftRemaining!==rightRemaining) return rightRemaining-leftRemaining;
    return DATASETS.indexOf(left.meta)-DATASETS.indexOf(right.meta);
  });
  let shown=0;
  for(const [index,{meta,dataset}] of entries.entries()) {
    const card=buildQueueCard(meta,dataset,index,expanded.has(dataset.id));
    if(!card.hidden) shown++;
    container.append(card);
  }
  byId('filter-empty').hidden=shown!==0;
  const unavailable=DATASETS.filter(meta=>!map.get(meta.id).available).length;
  const suffix=unavailable ? ` · ${unavailable} unavailable ${unavailable===1?'queue':'queues'}` : '';
  setText('queue-summary',`${formatCount(status.summary.pendingJobs)} pending · ${formatCount(status.summary.activeJobs)} active · ${formatCount(status.summary.blockedJobs)} blocked${suffix}`);
}

function renderRuntime(status) {
  const {runtime,summary}=status;
  const freshObservation=runtime.progressAt && Date.now()-Date.parse(runtime.progressAt)<=15*60*1000;
  const live=runtime.state==='active'&&runtime.phase==='collecting'&&freshObservation;
  const badge=byId('runtime-badge');
  const label=LABELS.phases[runtime.phase]||titleCase(runtime.phase);
  setText('runtime-label', label);
  badge.dataset.tone=runtime.phase==='collecting'?'good':runtime.phase==='recovering'?'info':runtime.phase==='attention'||runtime.state==='failed'?'bad':runtime.phase==='paused'?'warn':'neutral';
  setText('remaining-jobs',formatCount(summary.knownRemainingJobs));
  setText('blocked-jobs',formatCount(summary.blockedJobs));
  setText('active-jobs',formatCount(summary.activeJobs));
  setText('remaining-context',`${formatCount(summary.availableDatasets)} available · ${formatCount(summary.missingDatasets)} missing datasets`);
  setText('active-context',live?'Collector jobs currently in flight':'Latest published active-job count');
  if(live) {
    setText('productive-rps',formatRate(runtime.productiveRps30s));
    setText('rps-context','Productive payloads over the latest 30 seconds');
  } else {
    setText('productive-rps','—');
    setText('rps-context',isKnown(runtime.productiveRps30s)?`Last sampled ${formatRate(runtime.productiveRps30s)} RPS; not live now`:'No current productive-rate sample');
  }
  setText('runtime-phase',label);
  const transports=[];
  if(isKnown(runtime.activeTransports)) transports.push(`${formatCount(runtime.activeTransports)} active`);
  if(isKnown(runtime.qualifiedTransports)) transports.push(`${formatCount(runtime.qualifiedTransports)} qualified`);
  if(isKnown(runtime.questionTransports)) transports.push(`${formatCount(runtime.questionTransports)} question-ready`);
  setText('transport-counts',transports.join(' · ')||'Unknown');
  setText('runtime-version',runtime.version||'Unknown');
  setText('source-hold',runtime.sourcePauseUntil ? relativeAge(runtime.sourcePauseUntil) : 'None published');
  setTime('observed-at',runtime.progressAt);
  setTime('published-at',status.generatedAt);
  const publicationAge=Date.now()-Date.parse(status.generatedAt);
  const observationAge=runtime.progressAt ? Date.now()-Date.parse(runtime.progressAt) : Infinity;
  const notice=byId('freshness-notice');
  if(publicationAge>15*60*1000 || observationAge>15*60*1000 || !runtime.progressAt) {
    const parts=[];
    if(publicationAge>15*60*1000) parts.push(`publication is ${relativeAge(status.generatedAt)}`);
    if(!runtime.progressAt) parts.push('observation time is unavailable');
    else if(observationAge>15*60*1000) parts.push(`collector observation is ${relativeAge(runtime.progressAt)}`);
    notice.textContent=`Stale status: ${parts.join('; ')}. Counts below may have changed.`;
    notice.hidden=false;
  } else notice.hidden=true;
}

function renderCoverage(status) {
  const container=byId('coverage-list');
  container.replaceChildren();
  const outstanding=status.coverage.filter(item=>item.state==='unvalidated');
  for(const item of outstanding) {
    const row=element('div','attention-item');
    row.append(element('span','attention-icon','!'),element('span','',`${LABELS.coverage[item.id]||titleCase(item.id)} coverage remains unvalidated.`));
    container.append(row);
  }
  if(!outstanding.length) container.append(element('div','attention-item','No unvalidated coverage scopes are published.'));
  const backup=status.backup;
  setText('backup-status',`${titleCase(backup.status)} · ${titleCase(backup.phase)}`);
  let detail='No backup timestamp published';
  if(backup.uploadedAt) detail=`Uploaded ${relativeAge(backup.uploadedAt)} · captured ${relativeAge(backup.capturedAt)}`;
  else if(backup.capturedAt) detail=`Captured ${relativeAge(backup.capturedAt)} · upload not acknowledged`;
  setText('backup-detail',detail);
}

function netChange(first,last,key) {
  if(!isKnown(first?.[key])||!isKnown(last?.[key])) return null;
  return last[key]-first[key];
}
const signed = value => value>0?`+${formatCount(value)}`:formatCount(value);

function renderHistory(status) {
  const container=byId('history-content');
  const samples=status.history;
  container.replaceChildren();
  if(samples.length<2) {
    setText('history-window',samples.length?'One sample':'No samples');
    container.append(element('p','measuring','Pace is being measured. Recent deltas will appear after another valid sample.'));
    return;
  }
  const first=samples[0], last=samples[samples.length-1];
  const span=Date.parse(last.at)-Date.parse(first.at);
  setText('history-window',span>0?`${Math.max(1,Math.round(span/60000))} min window`:`${samples.length} samples`);
  const firstMap=new Map(first.datasets.map(item=>[item.id,item]));
  const lastMap=new Map(last.datasets.map(item=>[item.id,item]));
  const list=element('ul','delta-list');
  for(const meta of DATASETS) {
    const oldValue=firstMap.get(meta.id),newValue=lastMap.get(meta.id);
    const completed=netChange(oldValue,newValue,'completeJobs');
    const remaining=netChange(oldValue,newValue,'remainingJobs');
    const recordKey=meta.id==='tests'||meta.id==='DppQuiz'?'papers':'records';
    const records=netChange(oldValue,newValue,recordKey);
    const parts=[];
    if(isKnown(completed)&&completed!==0) parts.push(`${signed(completed)} jobs done`);
    if(isKnown(remaining)&&remaining!==0) parts.push(`${signed(remaining)} remaining`);
    if(isKnown(records)&&records!==0) parts.push(`${signed(records)} ${recordKey}`);
    if(!parts.length) continue;
    const item=element('li');
    item.append(element('span','',meta.name),element('strong','',parts.join(' · ')));
    list.append(item);
  }
  if(!list.childElementCount) container.append(element('p','measuring','No net movement is visible between the oldest and newest retained samples.'));
  else container.append(list);
}

function renderFinish(status) {
  const items=[
    {key:'collection', title:'Collect all known metadata', description:'Drain available queues and resolve blocked or timed-wait work.'},
    {key:'finalArchive', title:'Create final full-harness archive', description:'Capture and upload the final metadata recovery archive.'},
    {key:'shutdown', title:'Stop owner VMs', description:'Shut down collection infrastructure after archive acceptance.'}
  ];
  const list=byId('finish-list');
  list.replaceChildren();
  for(const item of items) {
    const state=status.milestones[item.key];
    const li=element('li',state==='complete'?'is-complete':'');
    li.append(element('strong','',item.title),element('span','',item.description),element('span','finish-status',titleCase(state)));
    list.append(li);
  }
}

function renderVideo(status) {
  const video=status.datasets.find(item=>item.id==='videos');
  const container=byId('video-content');
  container.replaceChildren();
  if(!video.available) { container.append(element('span','','Video queue status unavailable')); return; }
  const phrases=[video.state==='complete'?'Complete':`${titleCase(video.state)} · ${formatCount(video.jobs.remaining)} remaining`];
  if(isKnown(video.counts.records)) phrases.push(`${formatCount(video.counts.records)} durable records`);
  if(isKnown(video.counts.placements)) phrases.push(`${formatCount(video.counts.placements)} placements`);
  for(const phrase of phrases) container.append(element('span','',phrase));
}

function renderUpdates(status) {
  const section=byId('updates-section'),list=byId('updates-list');
  list.replaceChildren();
  if(!status.updates.at||!status.updates.items.length) { section.hidden=true; return; }
  for(const item of status.updates.items) {
    const row=element('li','');row.append(element('strong','',LABELS.updates[item.id]||titleCase(item.id)));
    const detail=UPDATE_DETAILS[item.id]?.[item.state];
    if(detail)row.append(element('span','update-detail',detail));
    row.append(element('span','update-state',titleCase(item.state)));list.append(row);
  }
  section.hidden=false;
}

function render(status) {
  lastGood=status;
  renderRuntime(status);
  renderQueues(status);
  renderCoverage(status);
  renderHistory(status);
  renderFinish(status);
  renderVideo(status);
  renderUpdates(status);
}

async function refresh() {
  try {
    const response=await fetch(`work.json?t=${Date.now()}`,{cache:'no-store'});
    if(!response.ok) throw Error(`Status request returned ${response.status}`);
    const status=sanitizeWorkStatus(await response.json());
    render(status);
    byId('refresh-notice').hidden=true;
  } catch(error) {
    byId('refresh-notice').hidden=false;
    setText('refresh-message',lastGood?'Showing the last valid publication.':'No valid status publication is available yet.');
    if(!lastGood) {
      byId('runtime-badge').dataset.tone='bad';
      setText('runtime-label','Status unavailable');
    }
  }
}

if(typeof document!=='undefined') {
  for(const button of document.querySelectorAll('.filter-button')) {
    button.addEventListener('click',()=>{
      currentFilter=button.dataset.filter;
      for(const candidate of document.querySelectorAll('.filter-button')) {
        const active=candidate===button;
        candidate.classList.toggle('is-active',active);
        candidate.setAttribute('aria-pressed',String(active));
      }
      if(lastGood) renderQueues(lastGood);
    });
  }
  refresh();
  setInterval(refresh,30000);
}
