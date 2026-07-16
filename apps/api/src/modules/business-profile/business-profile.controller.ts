import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Patch,
  Res,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { requireIdempotencyKey, requireIfMatch } from "../knowledge/knowledge-v2-http.js";
import { knowledgeV2ValidationPipe } from "../knowledge/knowledge-v2-validation.pipe.js";
import { BusinessProfileService } from "./business-profile.service.js";
import { BusinessProfilePatchRequestDto } from "./dto/business-profile.dto.js";

type HeaderValue = string | string[] | undefined;

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@UsePipes(knowledgeV2ValidationPipe)
@Controller("business-profile")
export class BusinessProfileController {
  constructor(
    @Inject(BusinessProfileService) private readonly businessProfile: BusinessProfileService,
  ) {}

  @Get()
  @Roles("OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER")
  async get(
    @CurrentContext() context: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.businessProfile.get(context);
    response.setHeader("ETag", data.etag);
    return { data };
  }

  @Patch()
  @Roles("OWNER", "ADMIN", "MANAGER")
  async patch(
    @CurrentContext() context: RequestContext,
    @Body() dto: BusinessProfilePatchRequestDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.businessProfile.patch(
      context,
      dto,
      requireIdempotencyKey(idempotencyKey),
      requireIfMatch(ifMatch),
    );
    response.setHeader("ETag", data.etag);
    return { data };
  }
}
