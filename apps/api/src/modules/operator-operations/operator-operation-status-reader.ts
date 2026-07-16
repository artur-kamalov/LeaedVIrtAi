import { Injectable } from "@nestjs/common";
import type {
  OperationStatusReadInput,
  OperationStatusReader,
  OperationStatusReadResult,
} from "@leadvirt/integrations";

export const OPERATOR_OPERATION_STATUS_READER = Symbol(
  "leadvirt.operator-operation-status-reader",
);

@Injectable()
export class UnsupportedOperationStatusReader implements OperationStatusReader {
  readStatus(input: OperationStatusReadInput): Promise<OperationStatusReadResult> {
    void input;
    return Promise.resolve({ supported: false });
  }
}
