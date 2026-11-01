const CampaignRepository = require('../repositories/CampaignRepository');
const MessageQueueRepository = require('../repositories/MessageQueueRepository');

class CampaignRecoveryService {
  static reconcile({
    database = require('../database/db'),
    getQueueStatus = (queueId) => MessageQueueRepository.getStatus(queueId, database)
  } = {}) {
    const summary = {
      confirmed_attempts: 0,
      failed_attempts: 0,
      unknown_attempts: 0,
      paused_campaigns: 0,
      cancelled_campaigns: 0
    };
    const active = CampaignRepository.getActiveCampaigns(database);
    for (const campaignRow of active) {
      const campaign = CampaignRepository.getCampaign(campaignRow.id, database);
      const processing = CampaignRepository.getProcessingRecipient(campaign.id, database);
      if (processing) {
        if (!processing.attempt_id || !processing.queue_id) {
          if (processing.attempt_id) {
            CampaignRepository.finishAttempt(
              processing.attempt_id,
              'unknown',
              'RECOVERY_QUEUE_MISSING',
              'Không tìm thấy queue đã ghi trước restart',
              database
            );
          } else {
            database.prepare(`
              UPDATE campaign_recipients
              SET status = 'failed', last_error_code = 'RECOVERY_ATTEMPT_MISSING',
                  last_error = 'Không tìm thấy attempt đã ghi trước restart',
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = ? AND status = 'processing'
            `).run(processing.id);
          }
          CampaignRepository.addAudit(
            campaign.id,
            'recovery_attempt_unknown',
            { attempt_id: processing.attempt_id || null, reason: 'RECOVERY_QUEUE_MISSING' },
            processing.id,
            database
          );
          summary.unknown_attempts += 1;
        } else {
          const queue = getQueueStatus(processing.queue_id);
          if (!queue) {
            CampaignRepository.finishAttempt(
              processing.attempt_id,
              'unknown',
              'RECOVERY_QUEUE_MISSING',
              'Queue không còn tồn tại sau restart',
              database
            );
            CampaignRepository.addAudit(
              campaign.id,
              'recovery_attempt_unknown',
              { attempt_id: processing.attempt_id, queue_id: processing.queue_id },
              processing.id,
              database
            );
            summary.unknown_attempts += 1;
          } else if (queue.status === 'sent') {
            CampaignRepository.finishAttempt(
              processing.attempt_id,
              'confirmed',
              null,
              null,
              database
            );
            CampaignRepository.addAudit(
              campaign.id,
              'delivery_confirmed_after_recovery',
              { attempt_id: processing.attempt_id, queue_id: processing.queue_id },
              processing.id,
              database
            );
            summary.confirmed_attempts += 1;
          } else if (queue.status === 'failed') {
            CampaignRepository.finishAttempt(
              processing.attempt_id,
              'failed',
              queue.error_reason || 'QUEUE_SEND_FAILED',
              queue.error_reason || 'QUEUE_SEND_FAILED',
              database
            );
            CampaignRepository.addAudit(
              campaign.id,
              'delivery_failed_after_recovery',
              {
                attempt_id: processing.attempt_id,
                queue_id: processing.queue_id,
                error: queue.error_reason || 'QUEUE_SEND_FAILED'
              },
              processing.id,
              database
            );
            summary.failed_attempts += 1;
          }
        }
      }

      const latest = CampaignRepository.getCampaign(campaign.id, database);
      const stillProcessing = latest.recipients.some((recipient) => recipient.status === 'processing');
      if (latest.status === 'pausing' && !stillProcessing) {
        CampaignRepository.updateCampaignStatus(campaign.id, 'pausing', 'paused', database);
        CampaignRepository.addAudit(campaign.id, 'paused_after_recovery', {}, null, database);
        summary.paused_campaigns += 1;
      } else if (latest.status === 'cancelling' && !stillProcessing) {
        CampaignRepository.cancelPending(campaign.id, database);
        CampaignRepository.updateCampaignStatus(campaign.id, 'cancelling', 'cancelled', database);
        CampaignRepository.addAudit(campaign.id, 'cancelled_after_recovery', {}, null, database);
        summary.cancelled_campaigns += 1;
      }
    }
    return summary;
  }
}

module.exports = CampaignRecoveryService;
