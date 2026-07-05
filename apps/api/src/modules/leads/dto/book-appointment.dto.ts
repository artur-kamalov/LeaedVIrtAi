import { IsISO8601, IsOptional, IsString, MaxLength } from "class-validator";

export class BookAppointmentDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsISO8601()
  startsAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
