import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthRateLimitService } from "./auth-rate-limit.service.js";
import { AuthService } from "./auth.service.js";
import { WorkspaceAuthGuard } from "./workspace-auth.guard.js";

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRateLimitService, WorkspaceAuthGuard],
  exports: [AuthService, AuthRateLimitService, WorkspaceAuthGuard]
})
export class AuthModule {}

