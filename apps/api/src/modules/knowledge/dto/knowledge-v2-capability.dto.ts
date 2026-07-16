import type {
  KnowledgeV2CapabilityAutonomy,
  KnowledgeV2UpdateCapabilityRequest,
} from "@leadvirt/types";
import { IsBoolean, IsIn, IsOptional } from "class-validator";

export const knowledgeV2CapabilityAutonomyValues = [
  "ANSWER_ONLY",
  "COLLECT_INFORMATION",
  "PROPOSE_ACTION",
] as const satisfies readonly KnowledgeV2CapabilityAutonomy[];

export class KnowledgeV2UpdateCapabilityDto implements KnowledgeV2UpdateCapabilityRequest {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(knowledgeV2CapabilityAutonomyValues)
  allowedAutonomy?: KnowledgeV2CapabilityAutonomy;
}
