import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentContext } from "../../common/decorators/current-context.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { RequestContext } from "../../common/request-context.js";
import { AuthService } from "../auth/auth.service.js";
import { WorkspaceAuthGuard } from "../auth/workspace-auth.guard.js";
import { ChangePasswordDto } from "./dto/change-password.dto.js";
import { InviteTeamMemberDto } from "./dto/invite-team-member.dto.js";
import { TwoFactorCodeDto } from "./dto/two-factor-code.dto.js";
import { TwoFactorPasswordDto } from "./dto/two-factor-password.dto.js";
import { UpdateAccountSettingsDto } from "./dto/update-account-settings.dto.js";
import { UpdateLocalePreferenceDto } from "./dto/update-locale-preference.dto.js";
import { UpdateNotificationsDto } from "./dto/update-notifications.dto.js";
import { UpdateTeamMemberDto } from "./dto/update-team-member.dto.js";
import { SettingsService } from "./settings.service.js";

type HeaderValue = string | string[] | undefined;

@UseGuards(WorkspaceAuthGuard, RolesGuard)
@Controller("settings")
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly settingsService: SettingsService,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  @Get("account")
  async account(@CurrentContext() context: RequestContext) {
    const data = await this.settingsService.account(context);
    return { data };
  }

  @Patch("account")
  @Roles("OWNER", "ADMIN", "MANAGER")
  async updateAccount(
    @CurrentContext() context: RequestContext,
    @Body() dto: UpdateAccountSettingsDto,
    @Headers("if-match") ifMatch: HeaderValue,
  ) {
    const data = await this.settingsService.updateAccount(context, dto, ifMatch);
    return { data };
  }

  @Patch("preferences/locale")
  async updateLocalePreference(
    @CurrentContext() context: RequestContext,
    @Body() dto: UpdateLocalePreferenceDto,
  ) {
    return { data: await this.settingsService.updateLocalePreference(context, dto.locale) };
  }

  @Get("team")
  async team(@CurrentContext() context: RequestContext) {
    return { data: await this.settingsService.team(context) };
  }

  @Post("team")
  @Roles("OWNER", "ADMIN")
  async inviteTeamMember(
    @CurrentContext() context: RequestContext,
    @Body() dto: InviteTeamMemberDto,
  ) {
    return { data: await this.settingsService.inviteTeamMember(context, dto) };
  }

  @Patch("team/:membershipId")
  @Roles("OWNER", "ADMIN")
  async updateTeamMember(
    @CurrentContext() context: RequestContext,
    @Param("membershipId") membershipId: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return { data: await this.settingsService.updateTeamMember(context, membershipId, dto) };
  }

  @Delete("team/:membershipId")
  @Roles("OWNER", "ADMIN")
  async removeTeamMember(
    @CurrentContext() context: RequestContext,
    @Param("membershipId") membershipId: string,
  ) {
    return { data: await this.settingsService.removeTeamMember(context, membershipId) };
  }

  @Get("notifications")
  async notifications(@CurrentContext() context: RequestContext) {
    return { data: await this.settingsService.notifications(context) };
  }

  @Patch("notifications")
  async updateNotifications(
    @CurrentContext() context: RequestContext,
    @Body() dto: UpdateNotificationsDto,
  ) {
    return { data: await this.settingsService.updateNotifications(context, dto) };
  }

  @Get("security")
  async security(@CurrentContext() context: RequestContext) {
    return { data: await this.settingsService.security(context) };
  }

  @Patch("security/password")
  async changePassword(@CurrentContext() context: RequestContext, @Body() dto: ChangePasswordDto) {
    return { data: await this.authService.changePassword(context, dto) };
  }

  @Post("security/2fa/setup")
  async startTwoFactorSetup(@CurrentContext() context: RequestContext) {
    return { data: await this.authService.startTwoFactorSetup(context) };
  }

  @Post("security/2fa/enable")
  async enableTwoFactor(@CurrentContext() context: RequestContext, @Body() dto: TwoFactorCodeDto) {
    return { data: await this.authService.enableTwoFactor(context, dto.code) };
  }

  @Post("security/2fa/disable")
  async disableTwoFactor(
    @CurrentContext() context: RequestContext,
    @Body() dto: TwoFactorPasswordDto,
  ) {
    return { data: await this.authService.disableTwoFactor(context, dto.currentPassword) };
  }

  @Post("security/2fa/recovery-codes")
  async regenerateTwoFactorRecoveryCodes(
    @CurrentContext() context: RequestContext,
    @Body() dto: TwoFactorPasswordDto,
  ) {
    return {
      data: await this.authService.regenerateTwoFactorRecoveryCodes(context, dto.currentPassword),
    };
  }

  @Delete("security/sessions/:sessionId")
  async revokeSession(
    @CurrentContext() context: RequestContext,
    @Param("sessionId") sessionId: string,
  ) {
    return { data: await this.authService.revokeSession(context, sessionId) };
  }

  @Post("security/sessions/revoke-others")
  async revokeOtherSessions(@CurrentContext() context: RequestContext) {
    return { data: await this.authService.revokeOtherSessions(context) };
  }

  @Get("billing")
  billing() {
    return { data: this.settingsService.billing() };
  }

  @Get("api-keys")
  @Roles("OWNER", "ADMIN")
  async apiKeys(@CurrentContext() context: RequestContext) {
    return { data: await this.settingsService.apiKeys(context) };
  }

  @Post("api-keys")
  @Roles("OWNER", "ADMIN")
  createApiKey() {
    return { data: this.settingsService.createApiKey() };
  }

  @Delete("api-keys/:id")
  @Roles("OWNER", "ADMIN")
  async revokeApiKey(@CurrentContext() context: RequestContext, @Param("id") id: string) {
    return { data: await this.settingsService.revokeApiKey(context, id) };
  }
}
