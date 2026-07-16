import {
  OpenAICompatibleGroundedAnswerProvider,
  type GroundedAnswerProcessorAuthorizer,
  type GroundedAnswerProvider,
} from "@leadvirt/ai";
import {
  KnowledgeV2GroundedAnswerService,
  KnowledgeV2GroundedOutputPolicy,
  PrismaKnowledgeV2ModelProcessorAuthorizer,
  type KnowledgeV2QueryHashKeyring,
} from "@leadvirt/knowledge";
import type { AppConfigService } from "../../config/app-config.service.js";
import type { PrismaService } from "../database/prisma.service.js";

export function createKnowledgeV2GroundedAnswerService(
  prisma: PrismaService,
  config: AppConfigService,
  queryHashKeyring: KnowledgeV2QueryHashKeyring,
) {
  const identity = {
    provider: config.knowledgeV2GroundedAnswerProvider,
    model: config.knowledgeV2GroundedAnswerModel,
    version: config.knowledgeV2GroundedAnswerVersion,
    region: config.knowledgeV2GroundedAnswerRegion,
  };
  const configured = Boolean(
    config.knowledgeV2GroundedAnswerApproved &&
    config.knowledgeV2GroundedAnswerBaseUrl &&
    config.knowledgeV2GroundedAnswerApiKey &&
    Object.values(identity).every((value) => value && value !== "unconfigured"),
  );
  const provider: GroundedAnswerProvider = configured
    ? new OpenAICompatibleGroundedAnswerProvider({
        baseUrl: config.knowledgeV2GroundedAnswerBaseUrl!,
        apiKey: config.knowledgeV2GroundedAnswerApiKey!,
        ...identity,
        timeoutMs: config.knowledgeV2GroundedAnswerTimeoutMs,
      })
    : {
        identity,
        generate() {
          return Promise.reject(new Error("Grounded answer generation is not configured."));
        },
      };
  const authorizer: GroundedAnswerProcessorAuthorizer = configured
    ? new PrismaKnowledgeV2ModelProcessorAuthorizer(prisma, {
        policyVersion: config.knowledgeV2ModelProcessorPolicyVersion,
        promptPolicyVersion: config.knowledgeV2GroundedPromptPolicyVersion,
        ...identity,
        maxClassification: config.knowledgeV2ModelProcessorMaxClassification,
      })
    : { authorize() { return Promise.resolve(null); } };
  return new KnowledgeV2GroundedAnswerService(
    provider,
    authorizer,
    new KnowledgeV2GroundedOutputPolicy(),
    queryHashKeyring,
  );
}
