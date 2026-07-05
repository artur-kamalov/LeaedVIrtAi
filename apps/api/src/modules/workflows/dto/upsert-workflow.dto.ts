import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from "class-validator";

const statuses = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"] as const;
const stepTypes = ["TRIGGER", "AI_MESSAGE", "QUESTION", "CONDITION", "ACTION", "DELAY", "HANDOFF", "END"] as const;

export class UpsertWorkflowStepDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  id?: string;

  @IsIn(stepTypes)
  type!: (typeof stepTypes)[number];

  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  positionX?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  positionY?: number;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpsertWorkflowDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsIn(statuses)
  status?: (typeof statuses)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => UpsertWorkflowStepDto)
  steps?: UpsertWorkflowStepDto[];
}
