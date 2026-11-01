const path = require('path');
const asar = require('@electron/asar');
const asarPath = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/asar-patch/out3/app.asar';
const B = '\\';
function get(p) {
  return asar.extractFile(asarPath, p.split('/').join(B).replace(/^\\/, '')).toString('utf8');
}
const svc = get('dist/server/services/CommentLeadsService.js');
const qw = get('dist/server/services/QueueWorker.js');
const srv = get('dist/server/server.js');
function check(label, hay, needle, want) {
  const has = hay.includes(needle);
  console.log(label, has === want ? 'PASS' : `FAIL (found=${has})`);
}
check('svc destructure queueId     ', svc, 'const { queueId } = MessageQueueRepository.insertCampaignDispatch', true);
check('svc pin thread              ', svc, "UPDATE threads SET pinned = 1 WHERE id = ?", true);
check('svc unpin on reply          ', svc, "UPDATE threads SET pinned = 0 WHERE id = ?", true);
check('qw cold flag                ', qw, "startsWith('comment_lead_')", true);
check('qw send_via_profile         ', qw, 'send_via_profile: true, profile_uid: coldProfileUid', true);
check('srv queue fail on definitive', srv, "updateQueueStatusFromClientMessage(client_message_id, 'failed', failureText)", true);
check('srv camelCase kept          ', srv, 'postUrl: req.body?.post_url', true);
const bg = require('fs').readFileSync('C:/Users/Admin/Downloads/Duan/CRM_FB1/dist/extension/background.js', 'utf8');
check('ext handleColdOutreach      ', bg, 'handleColdOutreachProfileSend', true);
check('ext profile.php nav         ', bg, 'profile.php?id=', true);
check('ext Nhắn tin selector       ', bg, 'nh\\u1eafn tin', bg.includes('nhắn tin'));
check('ext passthrough flags       ', bg, 'send_via_profile: Boolean(data.send_via_profile)', true);
