import assert from "node:assert/strict";

import {
  classifyKnowledgeCapabilityIntentV1,
  type KnowledgeCapabilityIntentClassificationV1,
} from "./capability-intent-v1.js";
import type { KnowledgeCapabilityTypeV1 } from "./capability-snapshot-v1.js";

interface LocaleCases {
  locale: string;
  generalFaq: string;
  leadQualification: string;
  pricing: string;
  appointmentDiscovery: string;
  appointmentBooking: string;
  orderSupport: string;
  accountSupport: string;
  commerceRecommendation: string;
  regulatedTopic: string;
  humanHandoff: string;
}

const localeCases: readonly LocaleCases[] = [
  {
    locale: "en",
    generalFaq: "What are your business hours?",
    leadQualification: "Am I eligible for this service?",
    pricing: "How much does it cost?",
    appointmentDiscovery: "What appointment times are available?",
    appointmentBooking: "Please book an appointment for tomorrow.",
    orderSupport: "Where is my order?",
    accountSupport: "I forgot my account password.",
    commerceRecommendation: "Which product should I choose?",
    regulatedTopic: "Can you diagnose these symptoms?",
    humanHandoff: "I want to speak to a human.",
  },
  {
    locale: "ru",
    generalFaq: "Какие у вас часы работы?",
    leadQualification: "Подхожу ли я для этой услуги?",
    pricing: "Сколько это стоит?",
    appointmentDiscovery: "Какие окна доступны для записи?",
    appointmentBooking: "Запишите меня на завтра.",
    orderSupport: "Где мой заказ?",
    accountSupport: "Я забыл пароль от аккаунта.",
    commerceRecommendation: "Какой товар мне выбрать?",
    regulatedTopic: "Можете поставить диагноз по этим симптомам?",
    humanHandoff: "Соедините меня с оператором.",
  },
  {
    locale: "es",
    generalFaq: "¿Cuál es su horario comercial?",
    leadQualification: "¿Soy elegible para este servicio?",
    pricing: "¿Cuánto cuesta?",
    appointmentDiscovery: "¿Qué horarios están libres?",
    appointmentBooking: "Quiero reservar una cita.",
    orderSupport: "¿Dónde está mi pedido?",
    accountSupport: "Olvidé la contraseña de mi cuenta.",
    commerceRecommendation: "¿Qué producto debo elegir?",
    regulatedTopic: "¿Puede diagnosticar estos síntomas?",
    humanHandoff: "Quiero hablar con una persona.",
  },
  {
    locale: "fr",
    generalFaq: "Quels sont vos horaires d’ouverture ?",
    leadQualification: "Suis-je éligible à ce service ?",
    pricing: "Combien ça coûte ?",
    appointmentDiscovery: "Quels créneaux sont disponibles ?",
    appointmentBooking: "Je veux prendre rendez-vous.",
    orderSupport: "Où est ma commande ?",
    accountSupport: "J’ai oublié le mot de passe de mon compte.",
    commerceRecommendation: "Quel produit dois-je choisir ?",
    regulatedTopic: "Pouvez-vous diagnostiquer ces symptômes ?",
    humanHandoff: "Je veux parler à un humain.",
  },
  {
    locale: "de",
    generalFaq: "Was sind Ihre Öffnungszeiten?",
    leadQualification: "Bin ich für diesen Service berechtigt?",
    pricing: "Wie viel kostet das?",
    appointmentDiscovery: "Welche Termine sind verfügbar?",
    appointmentBooking: "Ich möchte einen Termin buchen.",
    orderSupport: "Wo ist meine Bestellung?",
    accountSupport: "Ich habe mein Konto-Passwort vergessen.",
    commerceRecommendation: "Welches Produkt soll ich wählen?",
    regulatedTopic: "Können Sie diese Symptome diagnostizieren?",
    humanHandoff: "Ich möchte mit einem Menschen sprechen.",
  },
  {
    locale: "pt",
    generalFaq: "Qual é o horário de funcionamento?",
    leadQualification: "Sou elegível para este serviço?",
    pricing: "Quanto custa?",
    appointmentDiscovery: "Quais horários estão livres?",
    appointmentBooking: "Quero agendar uma consulta.",
    orderSupport: "Onde está meu pedido?",
    accountSupport: "Esqueci a senha da minha conta.",
    commerceRecommendation: "Qual produto devo escolher?",
    regulatedTopic: "Pode diagnosticar estes sintomas?",
    humanHandoff: "Quero falar com uma pessoa.",
  },
];

function expectCapability(query: string, expected: KnowledgeCapabilityTypeV1, context: string) {
  const result = classifyKnowledgeCapabilityIntentV1(query);
  assert.equal(result.route, "CAPABILITY", `${context} unexpectedly requested handoff`);
  assert.equal(result.capabilityType, expected, `${context} selected the wrong capability`);
  assert.ok(
    result.matchedSignals.length > 0,
    `${context} did not preserve classification evidence`,
  );
  return result;
}

function expectHandoff(query: string, context: string) {
  const result = classifyKnowledgeCapabilityIntentV1(query);
  assert.equal(result.route, "HUMAN_HANDOFF", `${context} did not request handoff`);
  assert.equal(result.capabilityType, null, `${context} incorrectly selected a capability`);
  assert.equal(result.intent, "human_handoff", `${context} did not preserve handoff intent`);
}

for (const testCase of localeCases) {
  expectCapability(testCase.generalFaq, "GENERAL_FAQ", `${testCase.locale}:general FAQ`);
  expectCapability(
    testCase.leadQualification,
    "LEAD_QUALIFICATION",
    `${testCase.locale}:lead qualification`,
  );
  expectCapability(testCase.pricing, "PRICING", `${testCase.locale}:pricing`);
  expectCapability(
    testCase.appointmentDiscovery,
    "APPOINTMENT_DISCOVERY",
    `${testCase.locale}:appointment discovery`,
  );
  expectCapability(
    testCase.appointmentBooking,
    "APPOINTMENT_BOOKING",
    `${testCase.locale}:appointment booking`,
  );
  const order = expectCapability(
    testCase.orderSupport,
    "ORDER_ACCOUNT_SUPPORT",
    `${testCase.locale}:order support`,
  );
  assert.equal(order.intent, "order_status", `${testCase.locale}:order intent was lost`);
  const account = expectCapability(
    testCase.accountSupport,
    "ORDER_ACCOUNT_SUPPORT",
    `${testCase.locale}:account support`,
  );
  assert.equal(account.intent, "account_status", `${testCase.locale}:account intent was lost`);
  expectCapability(
    testCase.commerceRecommendation,
    "COMMERCE_RECOMMENDATION",
    `${testCase.locale}:commerce recommendation`,
  );
  expectCapability(
    testCase.regulatedTopic,
    "REGULATED_TOPIC",
    `${testCase.locale}:regulated topic`,
  );
  expectHandoff(testCase.humanHandoff, `${testCase.locale}:human handoff`);
}

const precedenceCases: ReadonlyArray<{
  query: string;
  capabilityType: KnowledgeCapabilityTypeV1 | null;
  route?: KnowledgeCapabilityIntentClassificationV1["route"];
}> = [
  {
    query: "I need a human to discuss a diagnosis and order refund.",
    capabilityType: null,
    route: "HUMAN_HANDOFF",
  },
  {
    query: "Can you diagnose a symptom and refund my order?",
    capabilityType: "REGULATED_TOPIC",
  },
  {
    query: "What price was charged for my missing order?",
    capabilityType: "ORDER_ACCOUNT_SUPPORT",
  },
  {
    query: "Why did my account subscription price change?",
    capabilityType: "ORDER_ACCOUNT_SUPPORT",
  },
  {
    query: "Please book the cheapest available appointment.",
    capabilityType: "APPOINTMENT_BOOKING",
  },
  { query: "What does the recommended product cost?", capabilityType: "PRICING" },
  {
    query: "Which compatible product should an eligible customer choose?",
    capabilityType: "COMMERCE_RECOMMENDATION",
  },
  { query: "Am I eligible for the service?", capabilityType: "LEAD_QUALIFICATION" },
];

for (const [index, testCase] of precedenceCases.entries()) {
  const result = classifyKnowledgeCapabilityIntentV1(testCase.query);
  assert.equal(
    result.route,
    testCase.route ?? "CAPABILITY",
    `precedence case ${index} route drifted`,
  );
  assert.equal(
    result.capabilityType,
    testCase.capabilityType,
    `precedence case ${index} selected a lower-priority route`,
  );
}

const intentAliasCases: ReadonlyArray<{
  intent: string;
  capabilityType: KnowledgeCapabilityTypeV1 | null;
  route?: KnowledgeCapabilityIntentClassificationV1["route"];
}> = [
  { intent: "general_faq", capabilityType: "GENERAL_FAQ" },
  { intent: "lead_qualification", capabilityType: "LEAD_QUALIFICATION" },
  { intent: "pricing", capabilityType: "PRICING" },
  { intent: "appointment_discovery", capabilityType: "APPOINTMENT_DISCOVERY" },
  { intent: "appointment_booking", capabilityType: "APPOINTMENT_BOOKING" },
  { intent: "order_account_support", capabilityType: "ORDER_ACCOUNT_SUPPORT" },
  { intent: "account_status", capabilityType: "ORDER_ACCOUNT_SUPPORT" },
  { intent: "commerce_recommendation", capabilityType: "COMMERCE_RECOMMENDATION" },
  { intent: "regulated_topic", capabilityType: "REGULATED_TOPIC" },
  { intent: "human_handoff", capabilityType: null, route: "HUMAN_HANDOFF" },
];

for (const testCase of intentAliasCases) {
  const result = classifyKnowledgeCapabilityIntentV1("", testCase.intent);
  assert.equal(result.route, testCase.route ?? "CAPABILITY", `${testCase.intent} route drifted`);
  assert.equal(
    result.capabilityType,
    testCase.capabilityType,
    `${testCase.intent} selected the wrong capability`,
  );
}

assert.equal(
  classifyKnowledgeCapabilityIntentV1("", "regulated_topic").capabilityType,
  "REGULATED_TOPIC",
  "trusted regulated intent hint did not fail closed",
);
assert.equal(
  classifyKnowledgeCapabilityIntentV1("Tell me about the company").normalizedQuery,
  "tell me about the company",
  "classifier did not reuse operational normalization",
);

console.log(
  JSON.stringify({
    ok: true,
    locales: localeCases.map((item) => item.locale),
    localeRouteCases: localeCases.length * 10,
    precedenceCases: precedenceCases.length,
    intentAliasCases: intentAliasCases.length,
  }),
);
