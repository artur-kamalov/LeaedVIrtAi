import { IsObject, IsOptional, IsString } from "class-validator";

export class UpdateOnboardingDto {
  @IsOptional()
  @IsString()
  currentStep?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class CompleteOnboardingStepDto {
  @IsString()
  step!: string;
}
