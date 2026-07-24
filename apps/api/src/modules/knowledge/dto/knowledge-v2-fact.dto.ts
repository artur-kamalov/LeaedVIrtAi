import type {
  KnowledgeV2BulkFactVerificationRequest,
  KnowledgeV2CreateFactRequest,
  KnowledgeV2FactAuthority,
  KnowledgeV2FactDecisionRequest,
  KnowledgeV2JsonValue,
  KnowledgeV2LifecycleStatus,
  KnowledgeV2LocaleBehavior,
  KnowledgeV2RiskLevel,
  KnowledgeV2ScopeInput,
  KnowledgeV2UpdateFactRequest,
  KnowledgeV2VerificationStatus,
} from "@leadvirt/types";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsIn,
  IsISO4217CurrencyCode,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
  ValidateIf,
} from "class-validator";
import { KnowledgeV2PaginationDto } from "./knowledge-v2-pagination.dto.js";
import {
  IsAfterKnowledgeV2Date,
  IsKnowledgeV2JsonValue,
  IsKnowledgeV2Locale,
  IsKnowledgeV2Scope,
  IsKnowledgeV2Timestamp,
  IsKnowledgeV2TimeZone,
} from "./knowledge-v2-validation.js";

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const FACT_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const TYPE_KEY = /^[A-Za-z][A-Za-z0-9_.-]*$/;

export const knowledgeV2LocaleBehaviors = [
  "LANGUAGE_NEUTRAL",
  "LOCALIZED",
  "LOCALE_SPECIFIC",
] as const;
export const knowledgeV2RiskLevels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const knowledgeV2FactAuthorities = [
  "INFERRED",
  "IMPORTED",
  "MANUAL",
  "TRUSTED_SOURCE",
  "OWNER_VERIFIED",
] as const;
export const knowledgeV2VerificationStatuses = [
  "UNVERIFIED",
  "PENDING_REVIEW",
  "VERIFIED",
  "REJECTED",
  "CONFLICTED",
] as const;
export const knowledgeV2LifecycleStatuses = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

abstract class KnowledgeV2FactValueDto {
  @IsDefined()
  @IsKnowledgeV2JsonValue()
  normalizedValue!: KnowledgeV2JsonValue;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2_000)
  displayValue?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(64)
  @Matches(/^[^\p{Cc}]+$/u)
  unit?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @IsISO4217CurrencyCode()
  currency?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(64)
  @IsKnowledgeV2TimeZone()
  timeZone?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(35)
  @IsKnowledgeV2Locale()
  locale?: string | null;

  @IsIn(knowledgeV2LocaleBehaviors)
  localeBehavior!: KnowledgeV2LocaleBehavior;

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

  @IsIn(knowledgeV2FactAuthorities)
  authority!: KnowledgeV2FactAuthority;

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

export class KnowledgeV2CreateFactDto
  extends KnowledgeV2FactValueDto
  implements KnowledgeV2CreateFactRequest
{
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  @Matches(FACT_KEY)
  factKey!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(TYPE_KEY)
  entityType!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(128)
  @Matches(OPAQUE_ID)
  entityId?: string | null;

  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(TYPE_KEY)
  fieldType!: string;
}

export class KnowledgeV2UpdateFactDto implements KnowledgeV2UpdateFactRequest {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsKnowledgeV2JsonValue()
  normalizedValue?: KnowledgeV2JsonValue;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2_000)
  displayValue?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(64)
  @Matches(/^[^\p{Cc}]+$/u)
  unit?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @IsISO4217CurrencyCode()
  currency?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(64)
  @IsKnowledgeV2TimeZone()
  timeZone?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(35)
  @IsKnowledgeV2Locale()
  locale?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2LocaleBehaviors)
  localeBehavior?: KnowledgeV2LocaleBehavior;

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

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2FactAuthorities)
  authority?: KnowledgeV2FactAuthority;

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

export class KnowledgeV2FactDecisionDto implements KnowledgeV2FactDecisionRequest {
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2_000)
  note?: string | null;
}

export class KnowledgeV2BulkFactVerificationItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(OPAQUE_ID)
  id!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(240)
  etag!: string;
}

export class KnowledgeV2BulkFactVerificationDto
  implements KnowledgeV2BulkFactVerificationRequest
{
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique((item: KnowledgeV2BulkFactVerificationItemDto) => item.id)
  @ValidateNested({ each: true })
  @Type(() => KnowledgeV2BulkFactVerificationItemDto)
  items!: KnowledgeV2BulkFactVerificationItemDto[];

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2_000)
  note?: string | null;
}

export class KnowledgeV2FactListQueryDto extends KnowledgeV2PaginationDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2RiskLevels)
  riskLevel?: KnowledgeV2RiskLevel;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2FactAuthorities)
  authority?: KnowledgeV2FactAuthority;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2VerificationStatuses)
  verificationStatus?: KnowledgeV2VerificationStatus;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2LifecycleStatuses)
  lifecycleStatus?: KnowledgeV2LifecycleStatus;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(64)
  @Matches(TYPE_KEY)
  entityType?: string;

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
