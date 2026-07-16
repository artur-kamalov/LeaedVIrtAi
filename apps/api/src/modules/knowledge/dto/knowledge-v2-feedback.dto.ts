import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from "class-validator";
import type {
  KnowledgeV2CorrectionTargetType,
  KnowledgeV2FeedbackCategory,
  KnowledgeV2ReviewAction,
  KnowledgeV2RiskLevel,
} from "@leadvirt/types";
import { knowledgeV2RiskLevels } from "./knowledge-v2-fact.dto.js";

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const MAX_RESTRICTED_TEXT_LENGTH = 8_000;

export const knowledgeV2FeedbackCategories = [
  "INCORRECT_ANSWER",
  "MISSING_ANSWER",
  "WRONG_GUIDANCE",
  "SHOULD_BE_UNANSWERABLE",
  "SHOULD_HANDOFF",
  "BAD_CITATION",
  "STALE_INFORMATION",
  "SECURITY_CONCERN",
  "OTHER",
] as const;

export const knowledgeV2FeedbackActions = [
  "REVIEW_VALUE",
  "CORRECT_SOURCE",
  "ADD_MISSING_ANSWER",
  "CHANGE_GUIDANCE",
  "MARK_UNANSWERABLE",
  "REQUIRE_HANDOFF",
  "EXCLUDE_CONTENT",
  "RETRY_SOURCE",
  "VERIFY_PERMISSION",
  "APPROVE",
  "REJECT",
  "DISMISS",
] as const;

export const knowledgeV2CorrectionTargetTypes = [
  "SOURCE",
  "DOCUMENT_REVISION",
  "FACT",
  "GUIDANCE_RULE",
  "MARK_UNANSWERABLE",
  "REQUIRE_HANDOFF",
] as const;

export class KnowledgeV2CreateFeedbackDto {
  @IsIn(knowledgeV2FeedbackCategories)
  category!: KnowledgeV2FeedbackCategory;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2RiskLevels)
  riskLevel?: KnowledgeV2RiskLevel;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(OPAQUE_ID)
  responseMessageId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(OPAQUE_ID)
  evaluationRunId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(OPAQUE_ID)
  evaluationResultId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(OPAQUE_ID)
  publicationId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(OPAQUE_ID)
  retrievalTraceId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(MAX_RESTRICTED_TEXT_LENGTH)
  @Matches(/\S/u)
  note?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2FeedbackActions)
  proposedAction?: KnowledgeV2ReviewAction;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2CorrectionTargetTypes)
  correctionTargetType?: KnowledgeV2CorrectionTargetType;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(OPAQUE_ID)
  sourceId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(OPAQUE_ID)
  documentRevisionId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(OPAQUE_ID)
  factId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(OPAQUE_ID)
  guidanceRuleId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(OPAQUE_ID, { each: true })
  evidenceReferenceIds?: string[];
}
