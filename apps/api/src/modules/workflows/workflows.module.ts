import { Module } from "@nestjs/common";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { WorkflowsController } from "./workflows.controller.js";
import { WorkflowsService } from "./workflows.service.js";

@Module({
  controllers: [WorkflowsController],
  providers: [WorkflowsService, RolesGuard],
  exports: [WorkflowsService]
})
export class WorkflowsModule {}
