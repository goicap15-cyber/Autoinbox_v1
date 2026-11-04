// Verify asar chứa toàn bộ marker build32 + 33 + 34.
const asar = require('@electron/asar');
const bg = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\extension\\background.js').toString();
const sched = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\server\\services\\InboxSyncScheduler.js').toString();
let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); };

// --- build34: personal sync giu slot active ---
check('b34 setPersonalSyncBusy fn', bg.includes('function setPersonalSyncBusy'));
check('b34 isPersonalSyncBusy fn', bg.includes('function isPersonalSyncBusy'));
check('b34 personalBusyUntil state', bg.includes('crmTabSwitch.personalBusyUntil'));
check('b34 page gap 15000', bg.includes('CRM_PAGE_TAB_SWITCH_MIN_GAP_MS = 15000'));
check('b34 busy 65000 (history/ondemand)', bg.includes('setPersonalSyncBusy(65000)'));
check('b34 busy 25000 (text send)', bg.includes('setPersonalSyncBusy(25000)'));
check('b34 busy 90000 (attachment)', bg.includes('setPersonalSyncBusy(90000)'));
check('b34 fire-time page drop', bg.includes('!pending.isMessengerHome && !pending.immediate && isPersonalSyncBusy()'));
check('b34 request-time page drop', bg.includes('!isMessengerHome && !immediate && isPersonalSyncBusy()'));
check('b34 pending messenger beats page', bg.includes('crmTabSwitch.pending && crmTabSwitch.pending.isMessengerHome && !isMessengerHome'));
check('b34 return suppressed when busy', /scheduleReturnToMessengerTab[\s\S]{0,1200}isPersonalSyncBusy\(\)/.test(bg));
check('b34 personal history activation immediate', bg.includes("requestTabActivation(tab.id, { isMessengerHome: true, immediate: true })"));

// --- build33 giu nguyen ---
check('b33 realtime doc tab chat', bg.includes("getRegisteredTab(FbCrmMessengerTabRoles.roleKey(account_id, 'chat'))"));
check('b33 bizTabs chi quet sau', bg.includes('const bizTabs = isRealtimeScan ? [] :'));
check('b33 messenger 5s / page 15s', bg.includes('isMessengerHome ? CRM_TAB_SWITCH_MIN_GAP_MS : CRM_PAGE_TAB_SWITCH_MIN_GAP_MS'));

// --- build32 giu nguyen ---
check('b32 windowSource always_on', sched.includes("state.windowSource = 'always_on'"));
check('b32 else-if chi clear khi operator', sched.includes("extensionLive && state.windowSource === 'operator'"));

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
