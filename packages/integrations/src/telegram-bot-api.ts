export interface TelegramBotProfile {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramWebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  allowed_updates?: string[];
}

interface TelegramMessage {
  message_id: number;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

function telegramBotApiBaseUrl() {
  return (process.env.TELEGRAM_BOT_API_BASE_URL?.trim() || "https://api.telegram.org").replace(
    /\/+$/,
    "",
  );
}

export class TelegramBotApiClient {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly apiBase = telegramBotApiBaseUrl(),
    private readonly timeoutMs = 10_000,
  ) {}

  getMe(botToken: string) {
    return this.call<TelegramBotProfile>(botToken, "getMe");
  }

  setWebhook(input: {
    botToken: string;
    url: string;
    secretToken: string;
    allowedUpdates: string[];
  }) {
    return this.call<boolean>(input.botToken, "setWebhook", {
      url: input.url,
      secret_token: input.secretToken,
      allowed_updates: input.allowedUpdates,
      drop_pending_updates: false,
    });
  }

  getWebhookInfo(botToken: string) {
    return this.call<TelegramWebhookInfo>(botToken, "getWebhookInfo");
  }

  deleteWebhook(botToken: string, options: { dropPendingUpdates?: boolean } = {}) {
    return this.call<boolean>(botToken, "deleteWebhook", {
      drop_pending_updates: options.dropPendingUpdates ?? false,
    });
  }

  sendMessage(input: { botToken: string; chatId: string; text: string; signal?: AbortSignal }) {
    return this.call<TelegramMessage>(
      input.botToken,
      "sendMessage",
      {
        chat_id: input.chatId,
        text: input.text,
      },
      input.signal,
    );
  }

  private async call<T>(
    botToken: string,
    method: string,
    payload: Record<string, unknown> = {},
    signal?: AbortSignal,
  ) {
    const token = botToken.trim();
    if (!token) throw new Error("Telegram bot token is required.");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const relayAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) relayAbort();
    else signal?.addEventListener("abort", relayAbort, { once: true });

    let response: Response;
    try {
      response = await this.fetcher(`${this.apiBase}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("Telegram request was cancelled.");
      }
      throw new Error("Telegram is temporarily unavailable. Please try again.");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", relayAbort);
    }

    let body: TelegramResponse<T>;
    try {
      body = (await response.json()) as TelegramResponse<T>;
    } catch {
      throw new Error("Telegram returned an invalid response.");
    }

    if (!response.ok || !body.ok || body.result === undefined) {
      throw new Error(body.description?.trim() || "Telegram rejected the request.");
    }
    return body.result;
  }
}
