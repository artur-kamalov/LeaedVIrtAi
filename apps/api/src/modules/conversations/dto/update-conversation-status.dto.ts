import { IsIn } from "class-validator";

const statuses = ["OPEN", "WAITING_FOR_CUSTOMER", "WAITING_FOR_HUMAN", "CLOSED"] as const;

export class UpdateConversationStatusDto {
  @IsIn(statuses)
  status!: (typeof statuses)[number];
}
