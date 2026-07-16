import type {
  KnowledgeV2AssignReviewRequest,
  KnowledgeV2BulkReviewExecuteRequest,
  KnowledgeV2BulkReviewPreviewRequest,
  KnowledgeV2ConflictDecision,
  KnowledgeV2ConflictListQuery,
  KnowledgeV2ConflictStatus,
  KnowledgeV2ConflictType,
  KnowledgeV2DismissReviewRequest,
  KnowledgeV2ResolveConflictRequest,
  KnowledgeV2ResolveReviewItemRequest,
  KnowledgeV2ReviewAction,
  KnowledgeV2ReviewItemListQuery,
  KnowledgeV2ReviewReason,
  KnowledgeV2ReviewStatus,
  KnowledgeV2RiskLevel,
} from "@leadvirt/types";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsISO8601,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { KnowledgeV2PaginationDto } from "./knowledge-v2-pagination.dto.js";

const reviewStatuses = [
  "OPEN",
  "ASSIGNED",
  "IN_REVIEW",
  "RESOLVED",
  "DISMISSED",
  "SUPERSEDED",
] as const;
const reviewReasons = [
  "MISSING_REQUIRED_INFORMATION",
  "CONFLICTING_VALUES",
  "INFERRED_HIGH_RISK",
  "LOW_CONFIDENCE_CONTENT",
  "SENSITIVE_CONTENT",
  "STALE_SOURCE",
  "INACCESSIBLE_SOURCE",
  "FAILING_TEST",
] as const;
const riskLevels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const conflictStatuses = ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED", "SUPERSEDED"] as const;
const conflictTypes = [
  "FACT_VALUE",
  "GUIDANCE_RULE",
  "AUTHORITY",
  "SCOPE_OVERLAP",
  "EFFECTIVE_PERIOD",
  "PERMISSION",
  "DUPLICATE_IDENTITY",
] as const;
const resolutionActions = [
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
] as const satisfies readonly Exclude<KnowledgeV2ReviewAction, "DISMISS">[];
const conflictResolutions = [
  "KEEP_LEFT",
  "KEEP_RIGHT",
  "MARK_UNANSWERABLE",
  "REQUIRE_HANDOFF",
] as const satisfies readonly KnowledgeV2ConflictDecision[];

class KnowledgeV2ReviewBaseListQueryDto extends KnowledgeV2PaginationDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  assignedToUserId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  sourceId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  query?: string;
}

export class KnowledgeV2ReviewItemListQueryDto
  extends KnowledgeV2ReviewBaseListQueryDto
  implements KnowledgeV2ReviewItemListQuery
{
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(reviewStatuses)
  status?: KnowledgeV2ReviewStatus;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(reviewReasons)
  reason?: KnowledgeV2ReviewReason;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(riskLevels)
  riskLevel?: KnowledgeV2RiskLevel;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  conflictId?: string;
}

export class KnowledgeV2ConflictListQueryDto
  extends KnowledgeV2ReviewBaseListQueryDto
  implements KnowledgeV2ConflictListQuery
{
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(conflictStatuses)
  status?: KnowledgeV2ConflictStatus;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(conflictTypes)
  conflictType?: KnowledgeV2ConflictType;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(riskLevels)
  severity?: KnowledgeV2RiskLevel;
}

export class KnowledgeV2AssignReviewDto implements KnowledgeV2AssignReviewRequest {
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  assigneeUserId?: string | null;
}

export class KnowledgeV2ResolveReviewItemDto implements KnowledgeV2ResolveReviewItemRequest {
  @IsIn(resolutionActions)
  action!: Exclude<KnowledgeV2ReviewAction, "DISMISS">;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2_000)
  rationale?: string | null;
}

export class KnowledgeV2ResolveConflictDto implements KnowledgeV2ResolveConflictRequest {
  @IsIn(conflictResolutions)
  resolution!: KnowledgeV2ConflictDecision;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2_000)
  rationale?: string | null;
}

export class KnowledgeV2BulkReviewPreviewDto implements KnowledgeV2BulkReviewPreviewRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(128, { each: true })
  itemIds!: string[];

  @IsIn(resolutionActions)
  action!: Exclude<KnowledgeV2ReviewAction, "DISMISS">;
}

export class KnowledgeV2BulkReviewExecuteItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  id!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(240)
  etag!: string;
}

export class KnowledgeV2BulkReviewExecuteDto implements KnowledgeV2BulkReviewExecuteRequest {
  @IsIn(resolutionActions)
  action!: Exclude<KnowledgeV2ReviewAction, "DISMISS">;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => KnowledgeV2BulkReviewExecuteItemDto)
  items!: KnowledgeV2BulkReviewExecuteItemDto[];

  @IsString()
  @Matches(/^[a-f0-9]{64}$/u)
  previewHash!: string;

  @IsISO8601({ strict: true })
  previewExpiresAt!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2_000)
  rationale?: string | null;
}

export class KnowledgeV2DismissReviewDto implements KnowledgeV2DismissReviewRequest {
  @IsString()
  @MinLength(3)
  @MaxLength(2_000)
  rationale!: string;
}
