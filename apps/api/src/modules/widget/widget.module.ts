import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { WorkflowsModule } from "../workflows/workflows.module.js";
import { WidgetController } from "./widget.controller.js";
import { WidgetService } from "./widget.service.js";

@Module({
  imports: [AiModule, WorkflowsModule],
  controllers: [WidgetController],
  providers: [WidgetService]
})
export class WidgetModule {}
