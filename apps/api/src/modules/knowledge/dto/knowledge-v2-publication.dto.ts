import type {
  KnowledgeV2CreatePublicationRequest,
  KnowledgeV2PublicationStatus,
  KnowledgeV2RollbackPublicationRequest,
  KnowledgeV2ValidatePublicationRequest,
} from "@leadvirt/types";
import {
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

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const knowledgeV2PublicationTargetKeys = ["workspace-v2"] as const;
export const knowledgeV2PublicationStatuses = [
  "VALIDATING",
  "READY",
  "PUBLISHING",
  "ACTIVE",
  "SUPERSEDED",
  "FAILED",
  "ROLLED_BACK",
] as const;

export class KnowledgeV2ValidatePublicationDto implements KnowledgeV2ValidatePublicationRequest {
  @IsIn(knowledgeV2PublicationTargetKeys)
  targetKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(OPAQUE_ID)
  candidateId!: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  candidateVersion!: number;
}

export class KnowledgeV2CreatePublicationDto implements KnowledgeV2CreatePublicationRequest {
  @IsIn(knowledgeV2PublicationTargetKeys)
  targetKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(OPAQUE_ID)
  candidateId!: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  candidateVersion!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(OPAQUE_ID)
  validationId!: string;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2_000)
  approvalNote?: string | null;
}

export class KnowledgeV2RollbackPublicationDto implements KnowledgeV2RollbackPublicationRequest {
  @IsString()
  @MinLength(5)
  @MaxLength(2_000)
  @Matches(/\S/u)
  reason!: string;
}

export class KnowledgeV2PublicationListQueryDto extends KnowledgeV2PaginationDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2PublicationTargetKeys)
  targetKey?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(knowledgeV2PublicationStatuses)
  status?: KnowledgeV2PublicationStatus;
}
