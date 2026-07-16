import type {
  KnowledgeV2CutoverRequest,
  KnowledgeV2ResumeLegacyMigrationRequest,
  KnowledgeV2StartLegacyMigrationRequest,
} from "@leadvirt/types";
import { IsInt, IsString, Matches, Max, Min, ValidateIf } from "class-validator";

export class KnowledgeV2StartLegacyMigrationDto implements KnowledgeV2StartLegacyMigrationRequest {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(25)
  batchSize?: number;
}

export class KnowledgeV2ResumeLegacyMigrationDto implements KnowledgeV2ResumeLegacyMigrationRequest {
  @IsInt()
  @Min(1)
  generation!: number;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(25)
  batchSize?: number;
}

export class KnowledgeV2CutoverDto implements KnowledgeV2CutoverRequest {
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{2,199}$/)
  migrationId!: string;

  @IsInt()
  @Min(1)
  migrationGeneration!: number;

  @IsInt()
  @Min(1)
  selectorGeneration!: number;
}
