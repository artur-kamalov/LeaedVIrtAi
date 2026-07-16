export const queueNames = [
  "ai.reply",
  "ai.extractLeadFields",
  "ai.followUp",
  "channels.processWebhook",
  "channels.sendMessage",
  "knowledge.ingest",
  "crm.syncLead",
  "analytics.aggregate",
  "billing.calculateUsage"
] as const;

export type LeadVirtQueueName = (typeof queueNames)[number];
