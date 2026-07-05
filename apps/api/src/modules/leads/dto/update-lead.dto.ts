import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

const statuses = ["NEW", "IN_PROGRESS", "QUALIFIED", "BOOKED", "ORDERED", "SENT_TO_CRM", "CLOSED", "LOST"] as const;
const temperatures = ["COLD", "WARM", "HOT"] as const;

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(statuses)
  status?: (typeof statuses)[number];

  @IsOptional()
  @IsIn(temperatures)
  temperature?: (typeof temperatures)[number];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  interest?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  summary?: string;
}
