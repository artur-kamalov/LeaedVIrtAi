import type {
  KnowledgeV2ApproverRole,
  KnowledgeV2CreateGuidanceRuleRequest,
  KnowledgeV2GuidanceCondition,
  KnowledgeV2GuidanceDecisionRequest,
  KnowledgeV2GuidanceReviewStatus,
  KnowledgeV2GuidanceRuleType,
  KnowledgeV2RiskLevel,
  KnowledgeV2ScopeInput,
  KnowledgeV2UpdateGuidanceRuleRequest,
} from "@leadvirt/types";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";
import { KnowledgeV2PaginationDto } from "./knowledge-v2-pagination.dto.js";
import { knowledgeV2RiskLevels } from "./knowledge-v2-fact.dto.js";
import {
  IsAfterKnowledgeV2Date,
  IsKnowledgeV2GuidanceCondition,
  IsKnowledgeV2Locale,
  IsKnowledgeV2Scope,
  IsKnowledgeV2Timestamp,
} from "./knowledge-v2-validation.js";

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const TIE_BREAK_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export const knowledgeV2GuidanceRuleTypes = [
  "RESPONSE",
  "PROHIBITION",
  "ESCALATION",
  "APPROVAL",
  "TOOL_USE",
  "STYLE",
] as const;
export const knowledgeV2ApproverRoles = ["OWNER", "ADMIN", "MANAGER"] as const;
export const knowledgeV2GuidanceReviewStatuses = [
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "DISABLED",
] as const;

abstract class KnowledgeV2GuidanceRuleValueDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Matches(/\S/u)
  title!: string;

  @IsIn(knowledgeV2GuidanceRuleTypes)
  type!: KnowledgeV2GuidanceRuleType;

  @IsKnowledgeV2GuidanceCondition()
  condition!: KnowledgeV2GuidanceCondition;

  @IsString()
  @MinLength(1)
  @MaxLength(8_000)
  @Matches(/\S/u)
  instruction!: string;

  @IsInt()
  @Min(-1_000)
  @Max(1_000)
  priority!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(TIE_BREAK_KEY)
  tieBreakKey!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsKnowledgeV2Scope()
  scope?: KnowledgeV2ScopeInput | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsKnowledgeV2Timestamp()
  effectiveFrom?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsKnowledgeV2Timestamp()
  @IsAfterKnowledgeV2Date("effectiveFrom", {
    message: "effectiveUntil must be later than effectiveFrom",
  })
  effectiveUntil?: string | null;

  @IsIn(knowledgeV2RiskLevels)
  riskLevel!: KnowledgeV2RiskLevel;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsIn(knowledgeV2ApproverRoles)
  requiredApproverRole?: KnowledgeV2ApproverRole | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(1_000, { each: true })
  @Matches(/\S/u, { each: true })
  examples?: string[];

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(128, { each: true })
  @Matches(OPAQUE_ID, { each: true })
  evidenceIds?: string[];
}

export class KnowledgeV2CreateGuidanceRuleDto
  extends KnowledgeV2GuidanceRuleValueDto
  implements KnowledgeV2CreateGuidanceRuleRequest {}

export class KnowledgeV2UpdateGuidanceRuleDto implements KnowledgeV2UpdateGuidanceRuleRequest {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Matches(/\S/u)
  title?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2GuidanceRuleTypes)
  type?: KnowledgeV2GuidanceRuleType;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsKnowledgeV2GuidanceCondition()
  condition?: KnowledgeV2GuidanceCondition;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(8_000)
  @Matches(/\S/u)
  instruction?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(-1_000)
  @Max(1_000)
  priority?: number;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(TIE_BREAK_KEY)
  tieBreakKey?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsKnowledgeV2Scope()
  scope?: KnowledgeV2ScopeInput | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsKnowledgeV2Timestamp()
  effectiveFrom?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsKnowledgeV2Timestamp()
  @IsAfterKnowledgeV2Date("effectiveFrom", {
    message: "effectiveUntil must be later than effectiveFrom",
  })
  effectiveUntil?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2RiskLevels)
  riskLevel?: KnowledgeV2RiskLevel;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsIn(knowledgeV2ApproverRoles)
  requiredApproverRole?: KnowledgeV2ApproverRole | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(1_000, { each: true })
  @Matches(/\S/u, { each: true })
  examples?: string[];

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(128, { each: true })
  @Matches(OPAQUE_ID, { each: true })
  evidenceIds?: string[];

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MinLength(3)
  @MaxLength(1_000)
  changeReason?: string | null;
}

export class KnowledgeV2GuidanceDecisionDto implements KnowledgeV2GuidanceDecisionRequest {
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2_000)
  note?: string | null;
}

export class KnowledgeV2GuidanceListQueryDto extends KnowledgeV2PaginationDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2GuidanceRuleTypes)
  type?: KnowledgeV2GuidanceRuleType;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2RiskLevels)
  riskLevel?: KnowledgeV2RiskLevel;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2GuidanceReviewStatuses)
  reviewStatus?: KnowledgeV2GuidanceReviewStatus;

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
