import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { BusinessImportFileScanner } from "@leadvirt/business-import";
import {
  ClamAvKnowledgeFileScanner,
  decodeKnowledgeObjectEncryptionKey,
  EncryptedFileKnowledgeObjectStore,
} from "@leadvirt/knowledge";
import { AppConfigService } from "../../config/app-config.service.js";
import { businessImportError } from "./business-import-http.js";

@Injectable()
export class BusinessImportRuntimeService {
  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  runtime() {
    const rootPath = this.config.knowledgeObjectStorePath?.trim();
    const encodedKey = this.config.knowledgeArtifactEncryptionKey?.trim();
    const scannerHost = this.config.knowledgeFileScannerHost?.trim();
    if (
      !this.config.businessImportEnabled ||
      !this.config.knowledgeFileScannerApproved ||
      !rootPath ||
      !isAbsolute(rootPath) ||
      !encodedKey ||
      !scannerHost
    ) this.disabled();
    let key: Uint8Array;
    try {
      key = decodeKnowledgeObjectEncryptionKey(encodedKey);
    } catch {
      this.disabled();
    }
    const uploadSigningKey = this.deriveKey(key!, "business-import-upload-v1");
    const previewSigningKey = this.deriveKey(key!, "business-import-preview-v1");
    return {
      maxBytes: this.config.businessImportMaxFileBytes,
      uploadTtlMs: this.config.businessImportUploadTtlSeconds * 1000,
      uploadStreamTimeoutMs: this.config.knowledgeFileUploadStreamTimeoutMs,
      scannerTimeoutMs: this.config.knowledgeFileScannerTimeoutMs,
      maxPendingPerTenant: this.config.businessImportMaxPendingPerTenant,
      uploadSigningKey,
      previewSigningKey,
      objectEncryptionKeyId: this.config.knowledgeArtifactEncryptionKeyId,
      store: new EncryptedFileKnowledgeObjectStore({
        rootPath,
        activeKey: { id: this.config.knowledgeArtifactEncryptionKeyId, key: key! },
        maxPlaintextBytes: this.config.businessImportMaxFileBytes,
      }),
      scanner: new ClamAvKnowledgeFileScanner({
        host: scannerHost,
        port: this.config.knowledgeFileScannerPort,
        version: this.config.knowledgeFileScannerVersion,
        approvedForProduction: this.config.knowledgeFileScannerApproved,
      }) as unknown as BusinessImportFileScanner,
      parser: {
        approved: this.config.businessImportParserApproved,
        url: this.config.businessImportParserUrl?.replace(/\/$/u, "") ?? null,
        version: this.config.businessImportParserVersion,
        timeoutMs: this.config.businessImportParserTimeoutMs,
      },
    };
  }

  uploadToken(input: { tenantId: string; importId: string; expiresAt: Date }) {
    const runtime = this.runtime();
    return createHmac("sha256", runtime.uploadSigningKey)
      .update(
        `business-import-upload-v1\0${input.tenantId}\0${input.importId}\0${input.expiresAt.toISOString()}`,
      )
      .digest("base64url");
  }

  verifyUploadToken(expectedHash: string, provided: string) {
    const expected = Buffer.from(expectedHash, "hex");
    const providedHash = createHash("sha256").update(provided).digest();
    if (
      !provided ||
      expected.byteLength !== providedHash.byteLength ||
      !timingSafeEqual(expected, providedHash)
    ) this.notFound();
  }

  previewSignature(value: unknown) {
    return createHmac("sha256", this.runtime().previewSigningKey)
      .update(JSON.stringify(value))
      .digest("hex");
  }

  private deriveKey(key: Uint8Array, salt: string) {
    return new Uint8Array(
      hkdfSync(
        "sha256",
        key,
        Buffer.from(salt, "utf8"),
        Buffer.from("leadvirt-business-import", "utf8"),
        32,
      ),
    );
  }

  private disabled(): never {
    throw businessImportError(
      HttpStatus.SERVICE_UNAVAILABLE,
      "BUSINESS_IMPORT_DISABLED",
      "Business information import is not available.",
    );
  }

  private notFound(): never {
    throw businessImportError(
      HttpStatus.NOT_FOUND,
      "BUSINESS_IMPORT_NOT_FOUND",
      "Import not found.",
    );
  }
}
