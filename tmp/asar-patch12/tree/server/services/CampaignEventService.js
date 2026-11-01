class CampaignEventService {
  static emit(io, campaign, recipient = null, auditEvent = null) {
    if (!io || !campaign) return;
    io.emit('CAMPAIGN_UPDATED', {
      campaign_id: campaign.id,
      status: campaign.status,
      counts: campaign.counts || null,
      updated_at: campaign.updated_at || new Date().toISOString(),
      version: Date.now()
    });
    if (recipient) {
      io.emit('CAMPAIGN_RECIPIENT_UPDATED', {
        campaign_id: campaign.id,
        campaign_recipient_id: recipient.id,
        status: recipient.status,
        attempt_count: recipient.attempt_count,
        last_error_code: recipient.last_error_code || null,
        last_error: recipient.last_error || null,
        updated_at: recipient.updated_at || new Date().toISOString(),
        version: Date.now()
      });
    }
    if (auditEvent) this.emitAudit(io, campaign.id, auditEvent);
  }

  static emitAudit(io, campaignId, auditEvent) {
    if (!io || !campaignId || !auditEvent) return;
    io.emit('CAMPAIGN_AUDIT_EVENT', {
      campaign_id: campaignId,
      audit_event: auditEvent,
      updated_at: auditEvent.created_at || new Date().toISOString(),
      version: Number(auditEvent.id) || Date.now()
    });
  }
}

module.exports = CampaignEventService;
