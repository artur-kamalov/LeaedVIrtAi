import { createHash } from "node:crypto";

export const KNOWLEDGE_HANDOFF_TEMPLATE_VERSION = "knowledge-handoff-v1";

const handoffMessages = {
  en: "I need to confirm that with a manager. I will preserve the details of your request so they can respond accurately.",
  ru: "\u041c\u043d\u0435 \u043d\u0443\u0436\u043d\u043e \u0443\u0442\u043e\u0447\u043d\u0438\u0442\u044c \u044d\u0442\u043e \u0443 \u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440\u0430. \u042f \u0441\u043e\u0445\u0440\u0430\u043d\u044e \u0434\u0435\u0442\u0430\u043b\u0438 \u0437\u0430\u043f\u0440\u043e\u0441\u0430, \u0447\u0442\u043e\u0431\u044b \u0432\u0430\u043c \u043e\u0442\u0432\u0435\u0442\u0438\u043b\u0438 \u0442\u043e\u0447\u043d\u043e.",
  de: "Ich muss das mit einem Mitarbeiter kl\u00e4ren. Ich halte die Details Ihrer Anfrage f\u00fcr eine genaue Antwort fest.",
  fr: "Je dois v\u00e9rifier cela avec un responsable. Je conserve les d\u00e9tails de votre demande afin qu'il puisse vous r\u00e9pondre pr\u00e9cis\u00e9ment.",
  es: "Necesito confirmarlo con un responsable. Conservar\u00e9 los detalles de su solicitud para que pueda responderle con precisi\u00f3n.",
  pt: "Preciso confirmar isso com um respons\u00e1vel. Vou preservar os detalhes do seu pedido para que ele responda com precis\u00e3o.",
} as const;

type HandoffLanguage = keyof typeof handoffMessages;

function handoffLanguage(locale: string): HandoffLanguage {
  const language = locale.toLocaleLowerCase("und").split("-")[0] ?? "en";
  return language in handoffMessages ? (language as HandoffLanguage) : "en";
}

export function knowledgeHandoffReplyV1(locale = "en") {
  const language = handoffLanguage(locale);
  return {
    text: handoffMessages[language],
    templateVersion: `${KNOWLEDGE_HANDOFF_TEMPLATE_VERSION}:${language}`,
  };
}

export function knowledgeHandoffReplyForTemplateV1(templateVersion: string) {
  const prefix = `${KNOWLEDGE_HANDOFF_TEMPLATE_VERSION}:`;
  if (!templateVersion.startsWith(prefix)) return null;
  const language = templateVersion.slice(prefix.length);
  if (!(language in handoffMessages)) return null;
  return handoffMessages[language as HandoffLanguage];
}

export function aiReplyContentHashV1(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
