import { Body, Controller, Headers, Inject, Param, Post } from "@nestjs/common";
import { WebhookService } from "./webhook.service.js";

@Controller("public/channels/webhook")
export class WebhookController {
  constructor(@Inject(WebhookService) private readonly webhookService: WebhookService) {}

  @Post(":publicKey/events")
  async event(
    @Param("publicKey") publicKey: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return { data: await this.webhookService.handleEvent(publicKey, body, headers) };
  }
}
