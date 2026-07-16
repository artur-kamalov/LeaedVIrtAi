import { Type } from "class-transformer";
import { IsIn, IsInt, IsString, Matches, Min, ValidateIf } from "class-validator";
import type {
  KnowledgeV2BatchEvaluationRunKind,
  KnowledgeV2EvaluationRunListQuery,
  KnowledgeV2EvaluationRunStatus,
  KnowledgeV2TestRunTarget,
} from "@leadvirt/types";
import { KnowledgeV2PaginationDto } from "./knowledge-v2-pagination.dto.js";

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export class KnowledgeV2CreateEvaluationRunDto {
  @IsIn(["ACTIVE", "DRAFT"] satisfies KnowledgeV2TestRunTarget[])
  target!: KnowledgeV2TestRunTarget;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(["MANUAL", "PUBLICATION"] satisfies KnowledgeV2BatchEvaluationRunKind[])
  runKind?: KnowledgeV2BatchEvaluationRunKind;

  @ValidateIf((object: KnowledgeV2CreateEvaluationRunDto) => object.target === "DRAFT")
  @IsString()
  @Matches(OPAQUE_ID)
  candidateId?: string;

  @ValidateIf((object: KnowledgeV2CreateEvaluationRunDto) => object.target === "DRAFT")
  @Type(() => Number)
  @IsInt()
  @Min(1)
  candidateVersion?: number;

  @ValidateIf((object: KnowledgeV2CreateEvaluationRunDto) => object.target === "DRAFT")
  @IsString()
  @Matches(SHA256)
  candidateManifestHash?: string;
}

export class KnowledgeV2EvaluationRunListQueryDto
  extends KnowledgeV2PaginationDto
  implements KnowledgeV2EvaluationRunListQuery
{
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] satisfies KnowledgeV2EvaluationRunStatus[])
  status?: KnowledgeV2EvaluationRunStatus;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(["MANUAL", "PUBLICATION"] satisfies KnowledgeV2BatchEvaluationRunKind[])
  runKind?: KnowledgeV2BatchEvaluationRunKind;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(["ACTIVE", "DRAFT"] satisfies KnowledgeV2TestRunTarget[])
  target?: KnowledgeV2TestRunTarget;
}
