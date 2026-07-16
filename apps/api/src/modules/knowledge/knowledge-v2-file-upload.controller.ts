import { Controller, Headers, HttpCode, HttpStatus, Inject, Param, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { KnowledgeV2FileUploadService } from "./knowledge-v2-file-upload.service.js";

@Controller("knowledge/v2/file-uploads")
export class KnowledgeV2FileUploadController {
  constructor(
    @Inject(KnowledgeV2FileUploadService)
    private readonly uploads: KnowledgeV2FileUploadService,
  ) {}

  @Put(":intentId/content")
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @Param("intentId") intentId: string,
    @Headers("authorization") authorization: string | undefined,
    @Headers("content-type") contentType: string | undefined,
    @Headers("content-length") contentLength: string | undefined,
    @Req() request: Request,
  ) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once("aborted", abort);
    try {
      return {
        data: await this.uploads.upload(
          intentId,
          authorization,
          contentType,
          contentLength,
          request,
          controller.signal,
        ),
      };
    } finally {
      request.removeListener("aborted", abort);
    }
  }
}
