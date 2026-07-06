import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export const knowledgeSourceTypes = ["BUSINESS_PROFILE", "CATALOG", "AVAILABILITY", "FAQ", "POLICY", "ESCALATION"] as const;

export class CreateKnowledgeSourceDto {
  @IsIn(knowledgeSourceTypes)
  type!: (typeof knowledgeSourceTypes)[number];

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  content!: string;

  @IsOptional()
  @IsObject()
  structuredData?: Record<string, unknown>;
}
