import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

const roles = ["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"] as const;

export class InviteTeamMemberDto {
  @IsEmail()
  @MaxLength(180)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsIn(roles)
  role!: (typeof roles)[number];
}
