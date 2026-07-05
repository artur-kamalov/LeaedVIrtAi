import { IsIn } from "class-validator";

const roles = ["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"] as const;

export class UpdateTeamMemberDto {
  @IsIn(roles)
  role!: (typeof roles)[number];
}
