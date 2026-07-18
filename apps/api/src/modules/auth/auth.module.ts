import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthRateLimitService } from "./auth-rate-limit.service.js";
import { AuthService } from "./auth.service.js";
import { EmailOtpChallengeService } from "./email-otp-challenge.service.js";
import { EmailOtpDeliveryService } from "./email-otp-delivery.service.js";
import { WorkspaceAuthGuard } from "./workspace-auth.guard.js";

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRateLimitService, EmailOtpChallengeService, EmailOtpDeliveryService, WorkspaceAuthGuard],
  exports: [AuthService, AuthRateLimitService, EmailOtpDeliveryService, WorkspaceAuthGuard]
})
export class AuthModule {}

