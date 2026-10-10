const test = require('node:test');
const assert = require('node:assert/strict');
const { getTestDatabase } = require('../helpers/testDatabase');
const { seedPageThread } = require('./campaignTestUtils');
const CampaignRepository = require('../../src/server/repositories/CampaignRepository');
const CampaignPhoneCaptureService = require('../../src/server/services/CampaignPhoneCaptureService');
const PhoneCaptureService = require('../../src/server/services/PhoneCaptureService');

async function withDatabase(run) {
  const db = getTestDatabase(':memory:');
  try {
    return await run(db);
  } finally {
    db.close();
  }
}

// Fake extension connection so RichMessageCapabilityService.getForThread
// reports text.enabled = true for the seeded Page account, without needing a
// real extension/WebSocket.
const fakeCapabilityOptions = { getConnection: () => ({ readyState: 1 }) };

function createRunningThankThenStopCampaign(db, threadId, thankYouText = 'Cảm ơn bạn!') {
  const campaign = CampaignRepository.createDraft({
    name: 'Thank then stop campaign',
    recipients: [{ thread_id: threadId, account_id: 'acct-1', source_id: 'src-page-1', eligibility_status: 'eligible' }],
    messages: [{ text_content: 'Msg 1' }, { text_content: 'Msg 2' }],
    phone_capture_policy: 'thank_then_stop',
    phone_capture_thank_you_text: thankYouText
  }, db);
  const recipientId = campaign.recipients[0].id;
  db.prepare('UPDATE campaign_recipients SET execution_order = 1 WHERE id = ?').run(recipientId);
  db.prepare("UPDATE campaigns SET status = 'running' WHERE id = ?").run(campaign.id);
  return { campaign, recipientId };
}

function captureFor(db, threadId, messageId, phone = '0912345678') {
  return PhoneCaptureService.processIncomingMessage({
    threadId, accountId: 'acct-1', messageId, content: phone, messageTimestampMs: 1000
  }, { database: db }).captures[0];
}

// Resolves the poll loop's very first check to the given delivery_status by
// updating the messages row before CampaignPhoneCaptureService looks at it -
// keeps the test synchronous-fast instead of relying on real timers.
async function settleThankYouAs(db, campaignRecipientId, phoneCaptureId, status) {
  const action = db.prepare(
    'SELECT thank_you_client_message_id FROM campaign_phone_capture_actions WHERE campaign_recipient_id = ? AND phone_capture_id = ?'
  ).get(campaignRecipientId, phoneCaptureId);
  db.prepare('UPDATE messages SET delivery_status = ? WHERE client_message_id = ?')
    .run(status, action.thank_you_client_message_id);
}

test('thank_then_stop queues exactly one thank-you, then stops after confirmation', () => withDatabase(async (db) => {
  seedPageThread(db, { id: 't-1' });
  const { campaign, recipientId } = createRunningThankThenStopCampaign(db, 't-1');
  const capture = captureFor(db, 't-1', 'mid.1');

  // Settle the thank-you as 'sent' the instant it's queued, so the poll loop
  // (1 fast fake tick) resolves immediately instead of waiting out a timeout.
  let settled = false;
  const fakeSleep = async () => {
    if (!settled) {
      await settleThankYouAs(db, recipientId, capture.id, 'sent');
      settled = true;
    }
  };

  await CampaignPhoneCaptureService.handleCaptures('t-1', [capture], {
    database: db, sleep: fakeSleep, capabilityOptions: fakeCapabilityOptions, pollIntervalMs: 0
  });

  const thankYouMessage = db.prepare(
    "SELECT * FROM messages WHERE thread_id = ? AND client_message_id LIKE 'phone_capture_thank_%'"
  ).get('t-1');
  assert.ok(thankYouMessage, 'thank-you message row should exist');
  assert.equal(thankYouMessage.content, 'Cảm ơn bạn!');

  const recipient = db.prepare('SELECT status FROM campaign_recipients WHERE id = ?').get(recipientId);
  assert.equal(recipient.status, 'cancelled');

  const action = db.prepare('SELECT state FROM campaign_phone_capture_actions WHERE campaign_recipient_id = ?').get(recipientId);
  assert.equal(action.state, 'stop_applied');

  const events = db.prepare(
    "SELECT event_type FROM campaign_audit_events WHERE campaign_id = ? ORDER BY id ASC"
  ).all(campaign.id).map((e) => e.event_type);
  assert.ok(events.includes('phone_capture_thank_queued'));
  assert.ok(events.includes('phone_capture_thank_confirmed'));
  assert.ok(events.includes('phone_capture_stop_applied'));

  // Replaying the same capture must never queue a second thank-you.
  const beforeCount = db.prepare("SELECT COUNT(*) c FROM messages WHERE client_message_id LIKE 'phone_capture_thank_%'").get().c;
  await CampaignPhoneCaptureService.handleCaptures('t-1', [capture], {
    database: db, sleep: fakeSleep, capabilityOptions: fakeCapabilityOptions, pollIntervalMs: 0
  });
  const afterCount = db.prepare("SELECT COUNT(*) c FROM messages WHERE client_message_id LIKE 'phone_capture_thank_%'").get().c;
  assert.equal(afterCount, beforeCount);
}));

test('thank_then_stop still stops remaining work when the thank-you fails to send', () => withDatabase(async (db) => {
  seedPageThread(db, { id: 't-2' });
  const { campaign, recipientId } = createRunningThankThenStopCampaign(db, 't-2');
  const capture = captureFor(db, 't-2', 'mid.2');

  let settled = false;
  const fakeSleep = async () => {
    if (!settled) {
      await settleThankYouAs(db, recipientId, capture.id, 'failed');
      settled = true;
    }
  };

  await CampaignPhoneCaptureService.handleCaptures('t-2', [capture], {
    database: db, sleep: fakeSleep, capabilityOptions: fakeCapabilityOptions, pollIntervalMs: 0
  });

  const recipient = db.prepare('SELECT status FROM campaign_recipients WHERE id = ?').get(recipientId);
  assert.equal(recipient.status, 'cancelled'); // still stops even though the thank-you failed

  const action = db.prepare('SELECT state FROM campaign_phone_capture_actions WHERE campaign_recipient_id = ?').get(recipientId);
  assert.equal(action.state, 'stop_applied');

  const events = db.prepare(
    "SELECT event_type FROM campaign_audit_events WHERE campaign_id = ? ORDER BY id ASC"
  ).all(campaign.id).map((e) => e.event_type);
  assert.ok(events.includes('phone_capture_thank_failed'));
  assert.ok(!events.includes('phone_capture_thank_confirmed'));
}));

test('thank_then_stop falls back to the default thank-you text when none is configured beyond validation minimum', () => withDatabase(async (db) => {
  seedPageThread(db, { id: 't-3' });
  const { recipientId } = createRunningThankThenStopCampaign(db, 't-3', 'Riêng biệt cho campaign này');
  const capture = captureFor(db, 't-3', 'mid.3');

  let settled = false;
  const fakeSleep = async () => {
    if (!settled) {
      await settleThankYouAs(db, recipientId, capture.id, 'sent');
      settled = true;
    }
  };
  await CampaignPhoneCaptureService.handleCaptures('t-3', [capture], {
    database: db, sleep: fakeSleep, capabilityOptions: fakeCapabilityOptions, pollIntervalMs: 0
  });

  const message = db.prepare("SELECT content FROM messages WHERE client_message_id LIKE 'phone_capture_thank_%'").get();
  assert.equal(message.content, 'Riêng biệt cho campaign này');
}));

test('thank-you submission throwing synchronously (e.g. disconnected source) still stops and audits the failure', () => withDatabase(async (db) => {
  seedPageThread(db, { id: 't-4', noToken: true });
  const { campaign, recipientId } = createRunningThankThenStopCampaign(db, 't-4');
  const capture = captureFor(db, 't-4', 'mid.4');

  // Page KHÔNG có token thật - RichMessageCapabilityService báo không gửi
  // được, RichMessageService.submit ném lỗi đồng bộ. (Thread page không còn
  // phụ thuộc extension kết nối nên trigger lỗi bằng cách thiếu token.)
  await CampaignPhoneCaptureService.handleCaptures('t-4', [capture], {
    database: db, sleep: async () => {}, capabilityOptions: {}, pollIntervalMs: 0
  });

  const recipient = db.prepare('SELECT status FROM campaign_recipients WHERE id = ?').get(recipientId);
  assert.equal(recipient.status, 'cancelled');
  const events = db.prepare(
    "SELECT event_type FROM campaign_audit_events WHERE campaign_id = ? ORDER BY id ASC"
  ).all(campaign.id).map((e) => e.event_type);
  assert.ok(events.includes('phone_capture_thank_failed'));
  assert.ok(!events.includes('phone_capture_thank_queued'));
}));
