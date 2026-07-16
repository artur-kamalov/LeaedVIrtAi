import { Body, Controller, Headers, Inject, Param, Post } from "@nestjs/common";
import { TelegramService } from "./telegram.service.js";

@Controller("public/channels/telegram")
export class TelegramController {
  constructor(@Inject(TelegramService) private readonly telegramService: TelegramService) {}

  @Post(":publicKey/webhook")
  async webhook(
    @Param("publicKey") publicKey: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return {
      data: await this.telegramService.handleWebhook(publicKey, body, headers, "TELEGRAM_WEBHOOK"),
    };
  }
}
