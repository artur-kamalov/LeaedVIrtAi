import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import {
  KnowledgeV2CutoverDto,
  KnowledgeV2ResumeLegacyMigrationDto,
  KnowledgeV2StartLegacyMigrationDto,
} from "./dto/knowledge-v2-migration.dto.js";
import { requireIdempotencyKey } from "./knowledge-v2-http.js";
import { KnowledgeV2MigrationService } from "./knowledge-v2-migration.service.js";
import { knowledgeV2ValidationPipe } from "./knowledge-v2-validation.pipe.js";

type HeaderValue = string | string[] | undefined;

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@UsePipes(knowledgeV2ValidationPipe)
@Roles("OWNER", "ADMIN")
@Controller("knowledge/v2/migrations")
export class KnowledgeV2MigrationController {
  constructor(
    @Inject(KnowledgeV2MigrationService)
    private readonly migrations: KnowledgeV2MigrationService,
  ) {}

  @Post("legacy")
  @HttpCode(HttpStatus.ACCEPTED)
  async start(
    @CurrentContext() context: RequestContext,
    @Body() dto: KnowledgeV2StartLegacyMigrationDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
  ) {
    return {
      data: await this.migrations.start(context, dto, requireIdempotencyKey(idempotencyKey)),
    };
  }

  @Get("legacy/:migrationId")
  async get(@CurrentContext() context: RequestContext, @Param("migrationId") migrationId: string) {
    return { data: await this.migrations.get(context, migrationId) };
  }

  @Post("legacy/:migrationId/resume")
  @HttpCode(HttpStatus.ACCEPTED)
  async resume(
    @CurrentContext() context: RequestContext,
    @Param("migrationId") migrationId: string,
    @Body() dto: KnowledgeV2ResumeLegacyMigrationDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
  ) {
    return {
      data: await this.migrations.resume(
        context,
        migrationId,
        dto,
        requireIdempotencyKey(idempotencyKey),
      ),
    };
  }

  @Get("corpus-selector")
  async selector(@CurrentContext() context: RequestContext) {
    return { data: await this.migrations.selector(context) };
  }

  @Post("corpus-selector/cutover")
  @HttpCode(HttpStatus.OK)
  async cutover(
    @CurrentContext() context: RequestContext,
    @Body() dto: KnowledgeV2CutoverDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
  ) {
    return {
      data: await this.migrations.cutover(context, dto, requireIdempotencyKey(idempotencyKey)),
    };
  }
}
