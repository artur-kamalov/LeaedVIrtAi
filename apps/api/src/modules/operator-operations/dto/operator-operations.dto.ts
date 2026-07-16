import type {
  OperatorOperationKind,
  OperatorOperationListQuery,
  OperatorOperationMutationRequest,
  OperatorOperationStatus,
} from "@leadvirt/types";
import { Type } from "class-transformer";
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

const kinds = [
  "EXTERNAL_OPERATION",
  "CHANNEL_DELIVERY",
  "TOOL_OPERATION",
  "RUNTIME_OUTBOX",
  "KNOWLEDGE_OUTBOX",
] as const;
const statuses = ["SUCCEEDED", "FAILED", "UNKNOWN", "RECONCILED", "DEAD_LETTER"] as const;

export class OperatorOperationListQueryDto implements OperatorOperationListQuery {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(1_024)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(kinds)
  kind?: OperatorOperationKind;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(statuses)
  status?: OperatorOperationStatus;
}

export class OperatorOperationMutationDto implements OperatorOperationMutationRequest {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export const operatorOperationKinds = kinds;
