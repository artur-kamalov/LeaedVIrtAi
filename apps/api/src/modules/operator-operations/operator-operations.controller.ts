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
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import {
  OperatorOperationListQueryDto,
  OperatorOperationMutationDto,
} from "./dto/operator-operations.dto.js";
import {
  requireOperatorIdempotencyKey,
  requireOperatorIfMatch,
} from "./operator-operations.http.js";
import { OperatorOperationsService } from "./operator-operations.service.js";

type HeaderValue = string | string[] | undefined;

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  }),
)
@Roles("OWNER", "ADMIN")
@Controller("operator/operations")
export class OperatorOperationsController {
  constructor(
    @Inject(OperatorOperationsService)
    private readonly operations: OperatorOperationsService,
  ) {}

  @Get()
  async list(
    @CurrentContext() context: RequestContext,
    @Query() query: OperatorOperationListQueryDto,
  ) {
    return { data: await this.operations.list(context, query) };
  }

  @Get(":kind/:operationId")
  async detail(
    @CurrentContext() context: RequestContext,
    @Param("kind") kind: string,
    @Param("operationId") operationId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.operations.get(context, kind, operationId);
    response.setHeader("ETag", data.etag);
    return { data };
  }

  @Post(":kind/:operationId/reconcile")
  @HttpCode(HttpStatus.OK)
  async reconcile(
    @CurrentContext() context: RequestContext,
    @Param("kind") kind: string,
    @Param("operationId") operationId: string,
    @Body() dto: OperatorOperationMutationDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.operations.reconcile(
      context,
      kind,
      operationId,
      dto,
      requireOperatorIdempotencyKey(idempotencyKey),
      requireOperatorIfMatch(ifMatch),
    );
    response.setHeader("ETag", data.resource.etag);
    return { data };
  }

  @Post(":kind/:operationId/redrive")
  @HttpCode(HttpStatus.CREATED)
  async redrive(
    @CurrentContext() context: RequestContext,
    @Param("kind") kind: string,
    @Param("operationId") operationId: string,
    @Body() dto: OperatorOperationMutationDto,
    @Headers("idempotency-key") idempotencyKey: HeaderValue,
    @Headers("if-match") ifMatch: HeaderValue,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.operations.redrive(
      context,
      kind,
      operationId,
      dto,
      requireOperatorIdempotencyKey(idempotencyKey),
      requireOperatorIfMatch(ifMatch),
    );
    response.setHeader("ETag", data.resource.etag);
    return { data };
  }
}
