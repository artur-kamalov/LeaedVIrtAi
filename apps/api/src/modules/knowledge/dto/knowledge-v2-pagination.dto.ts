import { Type } from "class-transformer";
import { IsInt, IsString, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";

export class KnowledgeV2PaginationDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(1_024)
  @Matches(/^[A-Za-z0-9+/=_-]+$/)
  cursor?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export { KnowledgeV2PaginationDto as KnowledgeV2CursorPaginationDto };
