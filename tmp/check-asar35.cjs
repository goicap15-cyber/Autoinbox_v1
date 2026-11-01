// Verify asar chứa marker build32-35.
const asar = require('@electron/asar');
const bg = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\extension\\background.js').toString();
const content = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\extension\\content.js').toString();
const injected = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\extension\\injected.js').toString();
const sched = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\server\\services\\InboxSyncScheduler.js').toString();
let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); };

// --- build35: fast-fetch GraphQL cho tin ca nhan ---
check('b35 bg dispatch helper', bg.includes('function dispatchPersonalGraphqlFastFetch'));
check('b35 bg goi trong SYNC_THREAD_MESSAGES', bg.includes('dispatchPersonalGraphqlFastFetch(message.data?.thread_id)'));
check('b35 bg restore template truoc fetch', /CRM_QUERY_TEMPLATE_RESTORE[\s\S]{0,320}type: 'CRM_FETCH_THREAD'/.test(bg));
check('b35 bg restore setPersonalSyncBusy cung luc', bg.indexOf('setPersonalSyncBusy(65000)') < bg.indexOf('dispatchPersonalGraphqlFastFetch(message.data?.thread_id)'));
check('b35 content relay restore', content.includes("'CRM_QUERY_TEMPLATE_RESTORE'"));
check('b35 injected nhan restore', injected.includes("data.type === 'CRM_QUERY_TEMPLATE_RESTORE'"));
check('b35 injected TEMPLATE_RESTORED log', injected.includes('TEMPLATE_RESTORED'));
check('b35 injected guard khong ghi de template', /CRM_QUERY_TEMPLATE_RESTORE[\s\S]{0,160}!crmCapturedQuery/.test(injected));
check('b35 injected splitter JSON noi tiep', injected.includes('function splitTopLevelJsonObjects'));
check('b35 injected fallback 2 splitter', /chunks\.length[\s\S]{0,120}splitTopLevelJsonObjects\(text\)/.test(injected));
check('b35 injected normalizeSlotKey', injected.includes('function normalizeSlotKey'));
check('b35 injected replay giu prefix', injected.includes('slotReplacementValue(slot, task.thread_id)'));
check('b35 injected PARSE_SPLIT log', injected.includes("stage: 'PARSE_SPLIT'"));
check('b35 injected splitter per-line', /try \{ chunks\.push\(JSON\.parse\(t\)\); continue; \} catch[\s\S]{0,80}splitTopLevelJsonObjects\(t\)/.test(injected));

// --- build34 giu nguyen ---
check('b34 setPersonalSyncBusy fn', bg.includes('function setPersonalSyncBusy'));
check('b34 busy 65000/25000/90000', bg.includes('setPersonalSyncBusy(65000)') && bg.includes('setPersonalSyncBusy(25000)') && bg.includes('setPersonalSyncBusy(90000)'));
check('b34 page gap 15000', bg.includes('CRM_PAGE_TAB_SWITCH_MIN_GAP_MS = 15000'));

// --- build33 giu nguyen ---
check('b33 realtime doc tab chat', bg.includes("getRegisteredTab(FbCrmMessengerTabRoles.roleKey(account_id, 'chat'))"));
check('b33 bizTabs chi quet sau', bg.includes('const bizTabs = isRealtimeScan ? [] :'));

// --- build32 giu nguyen ---
check('b32 windowSource always_on', sched.includes("state.windowSource = 'always_on'"));
check('b32 else-if chi clear khi operator', sched.includes("extensionLive && state.windowSource === 'operator'"));

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
