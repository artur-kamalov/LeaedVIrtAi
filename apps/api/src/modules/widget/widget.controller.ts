import { Body, Controller, Get, Headers, Inject, Param, Post } from "@nestjs/common";
import { SendWidgetMessageDto } from "./dto/send-widget-message.dto.js";
import { WidgetService } from "./widget.service.js";

@Controller("public/widget")
export class WidgetController {
  constructor(@Inject(WidgetService) private readonly widgetService: WidgetService) {}

  @Get(":publicKey/config")
  async getConfig(@Param("publicKey") publicKey: string) {
    return { data: await this.widgetService.getConfig(publicKey) };
  }

  @Post(":publicKey/messages")
  async sendMessage(
    @Param("publicKey") publicKey: string,
    @Body() dto: SendWidgetMessageDto,
    @Headers("user-agent") userAgent?: string
  ) {
    return { data: await this.widgetService.sendMessage(publicKey, dto, { userAgent }) };
  }
}
