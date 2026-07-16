import { connect } from "node:net";
import type { KnowledgeFileScanner } from "./file-admission.js";

export interface ClamAvKnowledgeFileScannerOptions {
  host: string;
  port?: number;
  version: string;
  approvedForProduction?: boolean;
}

export class ClamAvKnowledgeFileScanner implements KnowledgeFileScanner {
  readonly identity;

  constructor(private readonly options: ClamAvKnowledgeFileScannerOptions) {
    this.identity = {
      provider: "clamav",
      version: options.version,
      approvedForProduction: options.approvedForProduction === true,
    } as const;
  }

  async scan(input: Parameters<KnowledgeFileScanner["scan"]>[0]) {
    if (!this.options.host.trim()) return { verdict: "UNAVAILABLE" as const };
    return new Promise<Awaited<ReturnType<KnowledgeFileScanner["scan"]>>>((resolve) => {
      const socket = connect({ host: this.options.host, port: this.options.port ?? 3310 });
      const response: Buffer[] = [];
      let settled = false;
      const finish = (value: Awaited<ReturnType<KnowledgeFileScanner["scan"]>>) => {
        if (settled) return;
        settled = true;
        input.signal.removeEventListener("abort", abort);
        socket.destroy();
        resolve(value);
      };
      const abort = () => finish({ verdict: "UNAVAILABLE" });
      input.signal.addEventListener("abort", abort, { once: true });
      socket.once("error", () => finish({ verdict: "UNAVAILABLE" }));
      socket.on("data", (chunk: Buffer) => {
        response.push(chunk);
        if (response.reduce((total, value) => total + value.byteLength, 0) > 4096) {
          finish({ verdict: "UNAVAILABLE" });
        }
      });
      socket.once("end", () => {
        const verdict = Buffer.concat(response).toString("utf8").replace(/\0+$/u, "").trim();
        if (/^stream: OK$/u.test(verdict)) finish({ verdict: "CLEAN" });
        else if (/^stream: .+ FOUND$/u.test(verdict)) {
          finish({ verdict: "MALICIOUS", signature: verdict.slice(8, -6).trim() });
        } else finish({ verdict: "UNAVAILABLE" });
      });
      socket.once("connect", () => {
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(input.bytes.byteLength);
        socket.write("zINSTREAM\0");
        socket.write(length);
        socket.write(input.bytes);
        socket.end(Buffer.alloc(4));
      });
    });
  }
}
