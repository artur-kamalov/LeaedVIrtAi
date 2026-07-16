import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import type {
  ChannelType,
  KnowledgeV2Audience,
  KnowledgeV2ScopeInput,
  KnowledgeV2TestRunTarget,
} from "@leadvirt/types";
import { IsKnowledgeV2Locale, IsKnowledgeV2Scope } from "./knowledge-v2-validation.js";
import { knowledgeV2TestAudiences, knowledgeV2TestChannels } from "./knowledge-v2-test.dto.js";

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export class KnowledgeV2TestRunContextDto {
  @IsString()
  @MaxLength(35)
  @IsKnowledgeV2Locale()
  locale!: string;

  @IsIn(knowledgeV2TestChannels)
  channelType!: ChannelType;

  @IsIn(knowledgeV2TestAudiences)
  audience!: KnowledgeV2Audience;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsKnowledgeV2Scope()
  scope?: KnowledgeV2ScopeInput | null;
}

export class KnowledgeV2CreateTestRunDto extends KnowledgeV2TestRunContextDto {
  @ValidateIf((object: KnowledgeV2CreateTestRunDto) => !object.testCaseId)
  @IsString()
  @MaxLength(8_000)
  @Matches(/\S/u)
  question?: string;

  @ValidateIf((object: KnowledgeV2CreateTestRunDto) => !object.question)
  @IsString()
  @Matches(OPAQUE_ID)
  testCaseId?: string;

  @IsIn(["ACTIVE", "DRAFT"] satisfies KnowledgeV2TestRunTarget[])
  target!: KnowledgeV2TestRunTarget;

  @ValidateIf((object: KnowledgeV2CreateTestRunDto) => object.target === "DRAFT")
  @IsString()
  @Matches(OPAQUE_ID)
  candidateId?: string;

  @ValidateIf((object: KnowledgeV2CreateTestRunDto) => object.target === "DRAFT")
  @Type(() => Number)
  @IsInt()
  @Min(1)
  candidateVersion?: number;

  @ValidateIf((object: KnowledgeV2CreateTestRunDto) => object.target === "DRAFT")
  @IsString()
  @Matches(SHA256)
  candidateManifestHash?: string;
}
