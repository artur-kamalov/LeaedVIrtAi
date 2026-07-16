BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_tenantId_id_channelId_key"
  ON "Conversation"("tenantId", "id", "channelId");
CREATE UNIQUE INDEX IF NOT EXISTS "Message_tenantId_conversationId_id_key"
  ON "Message"("tenantId", "conversationId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "AiReplyRun_tenantId_conversationId_replyMessageId_key"
  ON "AiReplyRun"("tenantId", "conversationId", "replyMessageId");
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_activeExternalIdentity_key"
  ON "Conversation"("tenantId", "channelId", "externalConversationId")
  WHERE "deletedAt" IS NULL AND "channelId" IS NOT NULL AND "externalConversationId" IS NOT NULL;

ALTER TABLE "ChannelDeliveryOperation"
  ALTER COLUMN "channelId" SET NOT NULL;

ALTER TABLE "Message"
  DROP CONSTRAINT IF EXISTS "Message_conversationId_fkey",
  DROP CONSTRAINT IF EXISTS "Message_tenant_conversation_fkey",
  ADD CONSTRAINT "Message_tenant_conversation_fkey"
    FOREIGN KEY ("tenantId", "conversationId")
    REFERENCES "Conversation"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiReplyRun"
  DROP CONSTRAINT IF EXISTS "AiReplyRun_tenant_inbound_fkey",
  DROP CONSTRAINT IF EXISTS "AiReplyRun_tenant_reply_fkey",
  ADD CONSTRAINT "AiReplyRun_tenant_inbound_fkey"
    FOREIGN KEY ("tenantId", "conversationId", "inboundMessageId")
    REFERENCES "Message"("tenantId", "conversationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "AiReplyRun_tenant_reply_fkey"
    FOREIGN KEY ("tenantId", "conversationId", "replyMessageId")
    REFERENCES "Message"("tenantId", "conversationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "ChannelDeliveryOperation"
  DROP CONSTRAINT IF EXISTS "ChannelDeliveryOperation_tenant_message_fkey",
  DROP CONSTRAINT IF EXISTS "ChannelDeliveryOperation_tenant_conversation_fkey",
  ADD CONSTRAINT "ChannelDeliveryOperation_tenant_message_fkey"
    FOREIGN KEY ("tenantId", "conversationId", "messageId")
    REFERENCES "Message"("tenantId", "conversationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "ChannelDeliveryOperation_tenant_conversation_fkey"
    FOREIGN KEY ("tenantId", "conversationId", "channelId")
    REFERENCES "Conversation"("tenantId", "id", "channelId") ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT;
