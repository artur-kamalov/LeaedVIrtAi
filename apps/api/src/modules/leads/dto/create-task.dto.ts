import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from "class-validator";

const priorities = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export class CreateTaskDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsIn(priorities)
  priority?: (typeof priorities)[number];

  @IsOptional()
  @IsISO8601()
  dueAt?: string;
}
