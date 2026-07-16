import type {
  KnowledgeV2AutoPublishPolicy,
  KnowledgeV2EmbeddingProviderPolicy,
  KnowledgeV2ModelProcessorDescriptor,
  KnowledgeV2ModelProcessorPolicy,
  KnowledgeV2PublicationApprovalPolicy,
  KnowledgeV2PublicationScheduleInput,
  KnowledgeV2QueryEmbeddingProcessorPolicy,
  KnowledgeV2RerankerProcessorPolicy,
  KnowledgeV2RetrievalProcessorPolicy,
  KnowledgeV2ScopeInput,
  KnowledgeV2UpdateSettingsRequest,
} from "@leadvirt/types";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsString,
  MinLength,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import {
  IncludesKnowledgeV2Locale,
  IsKnowledgeV2Locale,
  IsKnowledgeV2LocaleList,
  IsKnowledgeV2PublicationSchedule,
  IsKnowledgeV2Scope,
} from "./knowledge-v2-validation.js";

export const knowledgeV2AutoPublishPolicies = ["OFF", "TRUSTED_LOW_RISK", "SCHEDULED"] as const;
export const knowledgeV2PublicationApprovalPolicies = ["OWNER_ONLY", "OWNER_OR_ADMIN"] as const;
const embeddingClassifications = [
  "PUBLIC",
  "INTERNAL",
  "CUSTOMER_PERSONAL",
  "SENSITIVE",
  "SECRET",
] as const;

export class KnowledgeV2EmbeddingProviderPolicyDto implements KnowledgeV2EmbeddingProviderPolicy {
  @Equals(1)
  schemaVersion!: 1;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  policyVersion!: string;

  @IsBoolean()
  @Equals(true)
  approved!: true;

  @Equals("openai-compatible")
  provider!: "openai-compatible";

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  deployment!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  region!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsIn(embeddingClassifications, { each: true })
  allowedClassifications!: KnowledgeV2EmbeddingProviderPolicy["allowedClassifications"];
}

export class KnowledgeV2QueryEmbeddingProcessorPolicyDto implements KnowledgeV2QueryEmbeddingProcessorPolicy {
  @Equals("openai-compatible")
  provider!: "openai-compatible";

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  deployment!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  region!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsIn(embeddingClassifications, { each: true })
  allowedClassifications!: KnowledgeV2QueryEmbeddingProcessorPolicy["allowedClassifications"];
}

export class KnowledgeV2RerankerProcessorPolicyDto implements KnowledgeV2RerankerProcessorPolicy {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  provider!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  model!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  version!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  region!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsIn(embeddingClassifications, { each: true })
  allowedClassifications!: KnowledgeV2RerankerProcessorPolicy["allowedClassifications"];
}

export class KnowledgeV2RetrievalProcessorPolicyDto implements KnowledgeV2RetrievalProcessorPolicy {
  @Equals(1)
  schemaVersion!: 1;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  policyVersion!: string;

  @IsBoolean()
  @Equals(true)
  approved!: true;

  @IsDefined()
  @ValidateNested()
  @Type(() => KnowledgeV2QueryEmbeddingProcessorPolicyDto)
  queryEmbedding!: KnowledgeV2QueryEmbeddingProcessorPolicyDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => KnowledgeV2RerankerProcessorPolicyDto)
  reranker!: KnowledgeV2RerankerProcessorPolicyDto;
}

export class KnowledgeV2ModelProcessorDescriptorDto implements KnowledgeV2ModelProcessorDescriptor {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  provider!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  model!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  version!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  region!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsIn(embeddingClassifications, { each: true })
  allowedClassifications!: KnowledgeV2ModelProcessorDescriptor["allowedClassifications"];
}

export class KnowledgeV2ModelProcessorPolicyDto implements KnowledgeV2ModelProcessorPolicy {
  @Equals(1)
  schemaVersion!: 1;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  policyVersion!: string;

  @IsBoolean()
  @Equals(true)
  approved!: true;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  promptPolicyVersion!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => KnowledgeV2ModelProcessorDescriptorDto)
  groundedAnswer!: KnowledgeV2ModelProcessorDescriptorDto;
}

export class KnowledgeV2UpdateSettingsDto implements KnowledgeV2UpdateSettingsRequest {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(35)
  @IsKnowledgeV2Locale()
  defaultLocale?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsKnowledgeV2LocaleList()
  @IncludesKnowledgeV2Locale("defaultLocale", {
    message: "supportedLocales must include defaultLocale",
  })
  supportedLocales?: string[];

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsKnowledgeV2Scope()
  defaultScope?: KnowledgeV2ScopeInput | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2AutoPublishPolicies)
  autoPublishPolicy?: KnowledgeV2AutoPublishPolicy;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2PublicationApprovalPolicies)
  publicationApprovalPolicy?: KnowledgeV2PublicationApprovalPolicy;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsKnowledgeV2PublicationSchedule()
  publicationSchedule?: KnowledgeV2PublicationScheduleInput | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @ValidateNested()
  @Type(() => KnowledgeV2EmbeddingProviderPolicyDto)
  embeddingProviderPolicy?: KnowledgeV2EmbeddingProviderPolicyDto | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @ValidateNested()
  @Type(() => KnowledgeV2RetrievalProcessorPolicyDto)
  retrievalProcessorPolicy?: KnowledgeV2RetrievalProcessorPolicyDto | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @ValidateNested()
  @Type(() => KnowledgeV2ModelProcessorPolicyDto)
  modelProcessorPolicy?: KnowledgeV2ModelProcessorPolicyDto | null;
}
