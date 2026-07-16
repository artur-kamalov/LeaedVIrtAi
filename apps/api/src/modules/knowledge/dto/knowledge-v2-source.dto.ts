import type {
  KnowledgeV2CreateSourceRequest,
  KnowledgeV2CreateFileUploadIntentRequest,
  KnowledgeV2DocumentListQuery,
  KnowledgeV2DocumentStatus,
  KnowledgeV2ExcludeRevisionRequest,
  KnowledgeV2RevisionListQuery,
  KnowledgeV2RevisionStatus,
  KnowledgeV2ScopeInput,
  KnowledgeV2SecurityClassification,
  KnowledgeV2SourceKind,
  KnowledgeV2SourceListQuery,
  KnowledgeV2SourceStatus,
  KnowledgeV2SourceSyncMode,
  KnowledgeV2UpdateSourceRequest,
} from "@leadvirt/types";
import { IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import { KnowledgeV2PaginationDto } from "./knowledge-v2-pagination.dto.js";
import { IsKnowledgeV2Locale, IsKnowledgeV2Scope } from "./knowledge-v2-validation.js";

const sourceKinds = ["MANUAL", "WEBSITE", "FILE"] as const;
const creatableSourceKinds = ["WEBSITE"] as const;
const sourceSyncModes = ["MANUAL"] as const;
const editableClassifications = ["PUBLIC", "INTERNAL"] as const;
const sourceStatuses = [
  "CONNECTING",
  "DISCOVERING",
  "SYNCING",
  "READY",
  "NEEDS_REVIEW",
  "PAUSED",
  "FAILED",
  "DISCONNECTED",
  "DELETING",
  "DELETED",
] as const;
const documentStatuses = ["DISCOVERED", "ACTIVE", "NEEDS_REVIEW", "TOMBSTONED", "DELETED"] as const;
const revisionStatuses = [
  "ACQUIRED",
  "SCANNING",
  "PARSING",
  "NORMALIZING",
  "EXTRACTING",
  "CHUNKING",
  "EMBEDDING",
  "INDEXING",
  "EVALUATING",
  "READY",
  "NEEDS_REVIEW",
  "QUARANTINED",
  "REJECTED",
  "PUBLISHED",
  "SUPERSEDED",
  "FAILED",
  "CANCELLED",
  "DELETED",
] as const;
const TYPE_KEY = /^[A-Za-z][A-Za-z0-9_.-]*$/;

export class KnowledgeV2CreateSourceDto implements KnowledgeV2CreateSourceRequest {
  @IsIn(creatableSourceKinds)
  kind!: KnowledgeV2SourceKind;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayName!: string;

  @ValidateIf((object: KnowledgeV2CreateSourceDto, value: unknown) =>
    object.kind === "WEBSITE" ? true : value !== undefined,
  )
  @IsString()
  @MinLength(9)
  @MaxLength(2_048)
  canonicalUri?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(sourceSyncModes)
  syncMode?: KnowledgeV2SourceSyncMode;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsKnowledgeV2Scope()
  defaultScope?: KnowledgeV2ScopeInput | null;

  @IsIn(editableClassifications)
  defaultClassification!: KnowledgeV2SecurityClassification;

  @IsString()
  @MaxLength(35)
  @IsKnowledgeV2Locale()
  defaultLocale!: string;
}

export class KnowledgeV2CreateFileUploadIntentDto
  implements KnowledgeV2CreateFileUploadIntentRequest
{
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayName!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(128)
  filename!: string;

  @IsIn(["text/plain", "text/csv", "application/pdf"])
  declaredMimeType!: "text/plain" | "text/csv" | "application/pdf";

  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024)
  byteSize!: number;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsKnowledgeV2Scope()
  defaultScope?: KnowledgeV2ScopeInput | null;

  @IsIn(editableClassifications)
  defaultClassification!: KnowledgeV2SecurityClassification;

  @IsString()
  @MaxLength(35)
  @IsKnowledgeV2Locale()
  defaultLocale!: string;
}

export class KnowledgeV2UpdateSourceDto implements KnowledgeV2UpdateSourceRequest {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayName?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(sourceSyncModes)
  syncMode?: KnowledgeV2SourceSyncMode;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsKnowledgeV2Scope()
  defaultScope?: KnowledgeV2ScopeInput | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(editableClassifications)
  defaultClassification?: KnowledgeV2SecurityClassification;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(35)
  @IsKnowledgeV2Locale()
  defaultLocale?: string;
}

export class KnowledgeV2SourceListQueryDto
  extends KnowledgeV2PaginationDto
  implements KnowledgeV2SourceListQuery
{
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(sourceKinds)
  kind?: KnowledgeV2SourceKind;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(sourceStatuses)
  status?: KnowledgeV2SourceStatus;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  query?: string;
}

export class KnowledgeV2DocumentListQueryDto
  extends KnowledgeV2PaginationDto
  implements KnowledgeV2DocumentListQuery
{
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(64)
  @Matches(TYPE_KEY)
  kind?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  sourceId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(documentStatuses)
  status?: KnowledgeV2DocumentStatus;

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

export class KnowledgeV2RevisionListQueryDto
  extends KnowledgeV2PaginationDto
  implements KnowledgeV2RevisionListQuery
{
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(revisionStatuses)
  status?: KnowledgeV2RevisionStatus;
}

export class KnowledgeV2SourceActionDto {
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(1_000)
  reason?: string | null;
}

export class KnowledgeV2DeleteSourceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1_000)
  reason!: string;
}

export class KnowledgeV2ExcludeRevisionDto implements KnowledgeV2ExcludeRevisionRequest {
  @IsString()
  @MinLength(3)
  @MaxLength(1_000)
  reason!: string;
}
