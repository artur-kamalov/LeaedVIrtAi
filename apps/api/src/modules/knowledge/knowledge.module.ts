import { Module } from "@nestjs/common";
import {
  createKnowledgeV2QueryHashKeyringFromEnvironment,
  LegacyKnowledgePublisher,
} from "@leadvirt/knowledge";
import { ConfigModule } from "../../config/config.module.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { PrismaService } from "../database/prisma.service.js";
import { KnowledgeController } from "./knowledge.controller.js";
import { KnowledgePublicationDispatcherService } from "./knowledge-publication-dispatcher.service.js";
import { knowledgeRuntimeConfig } from "./knowledge-runtime.js";
import { KnowledgeService } from "./knowledge.service.js";
import { KnowledgeV2Controller } from "./knowledge-v2.controller.js";
import { KnowledgeV2ContentReconciliationService } from "./knowledge-v2-content-reconciliation.service.js";
import { KnowledgeV2CapabilityService } from "./knowledge-v2-capability.service.js";
import { KnowledgeV2OnboardingProjectionService } from "./knowledge-v2-onboarding-projection.service.js";
import { KnowledgeV2ConflictCandidateReaderService } from "./knowledge-v2-conflict-candidate-reader.service.js";
import { KnowledgeV2BulkReviewService } from "./knowledge-v2-bulk-review.service.js";
import { KnowledgeV2FeedbackController } from "./knowledge-v2-feedback.controller.js";
import { KnowledgeV2FeedbackService } from "./knowledge-v2-feedback.service.js";
import { KnowledgeV2IdempotencyService } from "./knowledge-v2-idempotency.service.js";
import { KnowledgeV2IndexPreparationService } from "./knowledge-v2-index-preparation.service.js";
import { KnowledgeV2MigrationController } from "./knowledge-v2-migration.controller.js";
import { KnowledgeV2MigrationService } from "./knowledge-v2-migration.service.js";
import { KnowledgeV2PublicationDispatcherService } from "./knowledge-v2-publication-dispatcher.service.js";
import { KnowledgeV2PublicationService } from "./knowledge-v2-publication.service.js";
import { KnowledgeV2ReviewController } from "./knowledge-v2-review.controller.js";
import { KnowledgeV2ReviewDecisionService } from "./knowledge-v2-review-decision.service.js";
import { KnowledgeV2ReviewService } from "./knowledge-v2-review.service.js";
import { KnowledgeV2Service } from "./knowledge-v2.service.js";
import { KnowledgeV2SourceService } from "./knowledge-v2-source.service.js";
import { KnowledgeV2FileUploadController } from "./knowledge-v2-file-upload.controller.js";
import { KnowledgeV2FileUploadService } from "./knowledge-v2-file-upload.service.js";
import { KnowledgeV2TestController } from "./knowledge-v2-test.controller.js";
import { KnowledgeV2TestService } from "./knowledge-v2-test.service.js";
import { KnowledgeV2TestRunController } from "./knowledge-v2-test-run.controller.js";
import { KnowledgeV2EvaluationRunController } from "./knowledge-v2-evaluation-run.controller.js";
import { KnowledgeV2TestRunService } from "./knowledge-v2-test-run.service.js";
import { createKnowledgeV2RuntimeRetriever } from "./knowledge-v2-runtime.js";
import { createKnowledgeV2GroundedAnswerService } from "./knowledge-v2-grounded-answer.js";
import { KnowledgeSourceQueueService } from "./knowledge-source-queue.service.js";
import {
  KNOWLEDGE_V2_GROUNDED_ANSWER,
  KNOWLEDGE_V2_QUERY_HASH_KEYRING,
  KNOWLEDGE_V2_RUNTIME_RETRIEVER,
  LEGACY_KNOWLEDGE_PUBLISHER,
} from "./knowledge.tokens.js";

@Module({
  imports: [ConfigModule],
  controllers: [
    KnowledgeController,
    KnowledgeV2Controller,
    KnowledgeV2FileUploadController,
    KnowledgeV2FeedbackController,
    KnowledgeV2MigrationController,
    KnowledgeV2ReviewController,
    KnowledgeV2TestController,
    KnowledgeV2TestRunController,
    KnowledgeV2EvaluationRunController,
  ],
  providers: [
    KnowledgeService,
    KnowledgePublicationDispatcherService,
    KnowledgeV2Service,
    KnowledgeV2CapabilityService,
    KnowledgeV2ContentReconciliationService,
    KnowledgeV2OnboardingProjectionService,
    KnowledgeV2ConflictCandidateReaderService,
    KnowledgeV2BulkReviewService,
    KnowledgeV2FeedbackService,
    KnowledgeV2IdempotencyService,
    KnowledgeV2IndexPreparationService,
    KnowledgeV2MigrationService,
    KnowledgeV2PublicationService,
    KnowledgeV2PublicationDispatcherService,
    KnowledgeSourceQueueService,
    KnowledgeV2SourceService,
    KnowledgeV2FileUploadService,
    KnowledgeV2ReviewDecisionService,
    KnowledgeV2ReviewService,
    KnowledgeV2TestService,
    KnowledgeV2TestRunService,
    RolesGuard,
    {
      provide: KNOWLEDGE_V2_QUERY_HASH_KEYRING,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        createKnowledgeV2QueryHashKeyringFromEnvironment({
          NODE_ENV: config.env.NODE_ENV,
          APP_ENV: config.env.APP_ENV,
          KNOWLEDGE_QUERY_HMAC_ACTIVE_KEY_ID: config.knowledgeQueryHmacActiveKeyId,
          KNOWLEDGE_QUERY_HMAC_KEYS: config.knowledgeQueryHmacKeys,
        }),
    },
    {
      provide: LEGACY_KNOWLEDGE_PUBLISHER,
      inject: [PrismaService, AppConfigService],
      useFactory: (prisma: PrismaService, config: AppConfigService) =>
        new LegacyKnowledgePublisher(prisma, knowledgeRuntimeConfig(config)),
    },
    {
      provide: KNOWLEDGE_V2_RUNTIME_RETRIEVER,
      inject: [PrismaService, AppConfigService, KNOWLEDGE_V2_QUERY_HASH_KEYRING],
      useFactory: (
        prisma: PrismaService,
        config: AppConfigService,
        queryHashKeyring: ReturnType<typeof createKnowledgeV2QueryHashKeyringFromEnvironment>,
      ) => createKnowledgeV2RuntimeRetriever(prisma, config, queryHashKeyring),
    },
    {
      provide: KNOWLEDGE_V2_GROUNDED_ANSWER,
      inject: [PrismaService, AppConfigService, KNOWLEDGE_V2_QUERY_HASH_KEYRING],
      useFactory: (
        prisma: PrismaService,
        config: AppConfigService,
        queryHashKeyring: ReturnType<typeof createKnowledgeV2QueryHashKeyringFromEnvironment>,
      ) => createKnowledgeV2GroundedAnswerService(prisma, config, queryHashKeyring),
    },
  ],
  exports: [
    KnowledgeService,
    KnowledgeV2CapabilityService,
    KnowledgeV2IdempotencyService,
    KnowledgeV2PublicationService,
  ],
})
export class KnowledgeModule {}
