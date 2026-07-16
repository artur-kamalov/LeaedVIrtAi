import { Module } from "@nestjs/common";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { KnowledgeModule } from "../knowledge/knowledge.module.js";
import { OperatorOperationsController } from "./operator-operations.controller.js";
import {
  OPERATOR_OPERATION_STATUS_READER,
  UnsupportedOperationStatusReader,
} from "./operator-operation-status-reader.js";
import { OperatorOperationsService } from "./operator-operations.service.js";

@Module({
  imports: [KnowledgeModule],
  controllers: [OperatorOperationsController],
  providers: [
    RolesGuard,
    OperatorOperationsService,
    UnsupportedOperationStatusReader,
    {
      provide: OPERATOR_OPERATION_STATUS_READER,
      useExisting: UnsupportedOperationStatusReader,
    },
  ],
})
export class OperatorOperationsModule {}
