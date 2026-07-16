import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import type {
  ChannelType,
  KnowledgeV2ArchiveTestCaseRequest,
  KnowledgeV2Audience,
  KnowledgeV2CreateTestCaseRequest,
  KnowledgeV2ExpectedBehavior,
  KnowledgeV2RiskLevel,
  KnowledgeV2ScopeInput,
  KnowledgeV2TestCaseListQuery,
  KnowledgeV2TestCaseOrigin,
  KnowledgeV2TestCaseStatus,
  KnowledgeV2TestExpectationInput,
  KnowledgeV2TestExpectationKind,
  KnowledgeV2UpdateTestCaseRequest,
} from "@leadvirt/types";
import { knowledgeV2RiskLevels } from "./knowledge-v2-fact.dto.js";
import { KnowledgeV2PaginationDto } from "./knowledge-v2-pagination.dto.js";
import { IsKnowledgeV2Locale, IsKnowledgeV2Scope } from "./knowledge-v2-validation.js";

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const SAFE_KEY = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_RESTRICTED_TEXT_LENGTH = 8_000;

export const knowledgeV2TestCaseStatuses = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export const knowledgeV2TestCaseMutableStatuses = ["DRAFT", "ACTIVE"] as const;
export const knowledgeV2TestCaseOrigins = [
  "PLATFORM",
  "INDUSTRY_PACK",
  "TENANT",
  "ANONYMIZED_FAILURE",
  "SYNTHETIC",
] as const;
export const knowledgeV2ExpectedBehaviors = [
  "ANSWER",
  "ABSTAIN",
  "HANDOFF",
  "REFUSE",
  "TOOL_CALL",
  "HOLD_FOR_APPROVAL",
] as const;
export const knowledgeV2TestExpectationKinds = [
  "REQUIRED_FACT",
  "FORBIDDEN_FACT",
  "REQUIRED_GUIDANCE",
  "FORBIDDEN_GUIDANCE",
  "REQUIRED_EVIDENCE",
  "FORBIDDEN_CLAIM",
  "REQUIRED_TOOL",
  "FORBIDDEN_TOOL",
] as const;
export const knowledgeV2TestChannels = [
  "WEBSITE",
  "TELEGRAM",
  "WHATSAPP",
  "INSTAGRAM",
  "VK",
  "EMAIL",
  "WEBHOOK",
  "PHONE",
  "DEMO",
] as const;
export const knowledgeV2TestAudiences = ["PUBLIC", "AUTHENTICATED_CUSTOMER", "INTERNAL"] as const;

export class KnowledgeV2TestExpectationDto implements KnowledgeV2TestExpectationInput {
  @IsIn(knowledgeV2TestExpectationKinds)
  kind!: KnowledgeV2TestExpectationKind;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @Matches(OPAQUE_ID)
  factId?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @Matches(OPAQUE_ID)
  guidanceRuleId?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @Matches(OPAQUE_ID)
  evidenceReferenceId?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @Matches(SAFE_KEY)
  semanticKey?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @Matches(SHA256)
  expectedValueHash?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(MAX_RESTRICTED_TEXT_LENGTH)
  @Matches(/\S/u)
  restrictedExpectedValue?: string | null;
}

abstract class KnowledgeV2TestCaseVersionDto {
  @IsString()
  @MaxLength(MAX_RESTRICTED_TEXT_LENGTH)
  @Matches(/\S/u)
  question!: string;

  @IsIn(knowledgeV2ExpectedBehaviors)
  expectedBehavior!: KnowledgeV2ExpectedBehavior;

  @IsString()
  @MaxLength(35)
  @IsKnowledgeV2Locale()
  locale!: string;

  @IsIn(knowledgeV2TestChannels)
  channelType!: ChannelType;

  @IsIn(knowledgeV2TestAudiences)
  audience!: KnowledgeV2Audience;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsKnowledgeV2Scope()
  scope?: KnowledgeV2ScopeInput | null;

  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(SAFE_KEY, { each: true })
  sliceKeys!: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(SAFE_KEY)
  datasetVersion!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => KnowledgeV2TestExpectationDto)
  expectations!: KnowledgeV2TestExpectationDto[];
}

export class KnowledgeV2CreateTestCaseDto
  extends KnowledgeV2TestCaseVersionDto
  implements KnowledgeV2CreateTestCaseRequest
{
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Matches(/\S/u)
  safeLabel!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2TestCaseMutableStatuses)
  status?: Extract<KnowledgeV2TestCaseStatus, "DRAFT" | "ACTIVE">;

  @IsIn(knowledgeV2RiskLevels)
  riskLevel!: KnowledgeV2RiskLevel;

  @IsBoolean()
  critical!: boolean;
}

export class KnowledgeV2UpdateTestCaseDto implements KnowledgeV2UpdateTestCaseRequest {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Matches(/\S/u)
  safeLabel?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2TestCaseMutableStatuses)
  status?: Extract<KnowledgeV2TestCaseStatus, "DRAFT" | "ACTIVE">;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2RiskLevels)
  riskLevel?: KnowledgeV2RiskLevel;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  critical?: boolean;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(MAX_RESTRICTED_TEXT_LENGTH)
  @Matches(/\S/u)
  question?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2ExpectedBehaviors)
  expectedBehavior?: KnowledgeV2ExpectedBehavior;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(35)
  @IsKnowledgeV2Locale()
  locale?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2TestChannels)
  channelType?: ChannelType;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2TestAudiences)
  audience?: KnowledgeV2Audience;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsKnowledgeV2Scope()
  scope?: KnowledgeV2ScopeInput | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(SAFE_KEY, { each: true })
  sliceKeys?: string[];

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(SAFE_KEY)
  datasetVersion?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => KnowledgeV2TestExpectationDto)
  expectations?: KnowledgeV2TestExpectationDto[];
}

export class KnowledgeV2ArchiveTestCaseDto implements KnowledgeV2ArchiveTestCaseRequest {
  @IsString()
  @MinLength(3)
  @MaxLength(1_000)
  @Matches(/\S/u)
  reason!: string;
}

export class KnowledgeV2TestCaseListQueryDto
  extends KnowledgeV2PaginationDto
  implements KnowledgeV2TestCaseListQuery
{
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2TestCaseStatuses)
  status?: KnowledgeV2TestCaseStatus;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2TestCaseOrigins)
  origin?: KnowledgeV2TestCaseOrigin;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2RiskLevels)
  riskLevel?: KnowledgeV2RiskLevel;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    value === "true" ? true : value === "false" ? false : value,
  )
  @IsBoolean()
  critical?: boolean;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(35)
  @IsKnowledgeV2Locale()
  locale?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  query?: string;
}
