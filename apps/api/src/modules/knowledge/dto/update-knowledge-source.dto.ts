import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { knowledgeSourceTypes } from "./create-knowledge-source.dto.js";

export const knowledgeSourceStatuses = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;

export class UpdateKnowledgeSourceDto {
  @IsOptional()
  @IsIn(knowledgeSourceTypes)
  type?: (typeof knowledgeSourceTypes)[number];

  @IsOptional()
  @IsIn(knowledgeSourceStatuses)
  status?: (typeof knowledgeSourceStatuses)[number];

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  content?: string;

  @IsOptional()
  @IsObject()
  structuredData?: Record<string, unknown>;
}
