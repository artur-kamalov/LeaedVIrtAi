import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const now = new Date();
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000);
const daysFromNow = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60_000);

function hashSeedPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt:v1:${salt}:${hash}`;
}

async function cleanupDemoTenants() {
  const tenants = await prisma.tenant.findMany({
    where: { slug: { in: ["demo-company", "beautylab-demo"] } },
    select: { id: true }
  });
  const tenantIds = tenants.map((tenant) => tenant.id);

  if (tenantIds.length === 0) {
    return;
  }

  await prisma.workflowRunEvent.deleteMany({ where: { workflowRun: { tenantId: { in: tenantIds } } } });
  await prisma.integrationSyncLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.messageAttachment.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.aiUsageLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.leadEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.message.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.task.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.booking.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.order.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.workflowRun.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.workflowStep.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.integrationAccount.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.subscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.usageCounter.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.webhookEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.apiKey.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.onboardingState.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.conversation.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.lead.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.channel.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.workflow.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}

async function seedPlans() {
  const plans = [
    {
      code: "START",
      name: "Start",
      priceMonthlyRub: 9900,
      aiConversations: 500,
      channelsLimit: 2,
      usersLimit: 3,
      scenariosLimit: 3,
      features: {
        bestFor: "малый бизнес и тест одного AI-сценария",
        features: ["500 AI-диалогов", "2 канала", "3 пользователя", "3 сценария"]
      }
    },
    {
      code: "PROFESSIONAL",
      name: "Professional",
      priceMonthlyRub: 24900,
      aiConversations: 2500,
      channelsLimit: 5,
      usersLimit: 10,
      scenariosLimit: 15,
      features: {
        popular: true,
        bestFor: "основной рекомендуемый план",
        features: ["2 500 AI-диалогов", "5 каналов", "10 пользователей", "15 сценариев"]
      }
    },
    {
      code: "BUSINESS",
      name: "Business",
      priceMonthlyRub: 59900,
      aiConversations: 10000,
      channelsLimit: 10,
      usersLimit: 25,
      scenariosLimit: 50,
      features: {
        bestFor: "активные отделы продаж и несколько направлений",
        features: ["10 000 AI-диалогов", "10 каналов", "25 пользователей", "50 сценариев"]
      }
    },
    {
      code: "CORPORATE",
      name: "Corporate",
      priceMonthlyRub: 120000,
      aiConversations: null,
      channelsLimit: null,
      usersLimit: null,
      scenariosLimit: null,
      features: {
        priceLabel: "от 120 000 ₽",
        bestFor: "сети, клиники, e-commerce и холдинги",
        features: ["Индивидуальные лимиты", "SLA", "Кастомные интеграции", "Персональный менеджер внедрения"]
      }
    }
  ] as const;

  for (const plan of plans) {
    await prisma.billingPlan.upsert({
      where: { code: plan.code },
      update: plan,
      create: plan
    });
  }
}

async function main() {
  await cleanupDemoTenants();
  await seedPlans();

  const professionalPlan = await prisma.billingPlan.findUniqueOrThrow({
    where: { code: "PROFESSIONAL" }
  });

  const tenant = await prisma.tenant.create({
    data: {
      name: "Демо-компания",
      slug: "demo-company",
      businessType: "universal demo",
      timezone: "Europe/Moscow",
      status: "ACTIVE",
      settings: {
        productName: "LeadVirt.ai",
        demoBusinessName: "Демо-компания",
        locale: "ru-RU",
        aiTone: "friendly, concise, careful with commitments"
      }
    }
  });

  const demoPasswordHash = hashSeedPassword("demo-demo");
  const user = await prisma.user.upsert({
    where: { email: "admin@leadvirt.ai" },
    update: { name: "Демо-менеджер", passwordHash: demoPasswordHash, passwordChangeRequired: false },
    create: {
      email: "admin@leadvirt.ai",
      name: "Демо-менеджер",
      passwordHash: demoPasswordHash,
      passwordChangeRequired: false
    }
  });

  await prisma.membership.create({
    data: { tenantId: tenant.id, userId: user.id, role: "OWNER" }
  });

  const channelSeeds = [
    { type: "WEBSITE", status: "ACTIVE", name: "Виджет сайта", publicKey: "demo-website-widget" },
    { type: "INSTAGRAM", status: "ACTIVE", name: "Instagram Direct", externalId: "ig_demo_company" },
    { type: "WHATSAPP", status: "PENDING", name: "WhatsApp Business", externalId: "wa_demo_company" },
    { type: "TELEGRAM", status: "ACTIVE", name: "Telegram-бот", externalId: "leadvirt_demo_bot", publicKey: "demo-telegram-webhook" },
    { type: "VK", status: "PENDING", name: "VK messages", externalId: "vk_demo_company" },
    { type: "EMAIL", status: "ACTIVE", name: "Email inbox", externalId: "sales@demo-company.local" },
    { type: "WEBHOOK", status: "ACTIVE", name: "Webhook/API", externalId: "demo_webhook_api", publicKey: "demo-generic-webhook" },
    { type: "PHONE", status: "COMING_SOON", name: "Calls", externalId: "+7-demo-calls" }
  ] as const;

  const channels = await Promise.all(
    channelSeeds.map((channel) =>
      prisma.channel.create({
        data: {
          tenantId: tenant.id,
          ...channel,
          settings:
            channel.type === "WEBSITE"
              ? {
                  demo: true,
                  widget: {
                    title: "LeadVirt.ai",
                    subtitle: "AI-администратор",
                    businessName: "Демо-компания",
                    welcomeMessage: "Здравствуйте! Я AI-администратор LeadVirt.ai. Отвечу на вопросы, уточню заявку и передам контекст менеджеру.",
                    primaryColor: "#34d399",
                    accentColor: "#10b981",
                    position: "bottom-right",
                    locale: "ru-RU",
                    suggestedReplies: ["Хочу записаться", "Сколько стоит?", "Позовите менеджера"],
                    consentText: "Отправляя сообщение, вы соглашаетесь, что команда может связаться с вами по этой заявке.",
                    poweredBy: "LeadVirt.ai"
                  }
                }
              : channel.type === "TELEGRAM"
                ? {
                    demo: true,
                    telegram: {
                      botUsername: "leadvirt_demo_bot",
                      webhookPublicKey: "demo-telegram-webhook",
                      webhookSecret: "demo-telegram-secret",
                      autoReply: true
                    }
                  }
                : channel.type === "WEBHOOK"
                  ? {
                      demo: true,
                      webhook: {
                        publicKey: "demo-generic-webhook",
                        secret: "demo-webhook-secret",
                        autoReply: true,
                        acceptedHeaders: ["x-leadvirt-webhook-secret", "authorization"]
                      }
                    }
                : { demo: true }
        }
      })
    )
  );
  const channelByType = new Map(channels.map((channel) => [channel.type, channel]));
  type SeedChannelType = (typeof channelSeeds)[number]["type"];

  type LeadSeed = {
    name: string;
    phone?: string;
    email?: string;
    source: string;
    channelType: SeedChannelType;
    status: "NEW" | "IN_PROGRESS" | "QUALIFIED" | "BOOKED" | "ORDERED" | "SENT_TO_CRM" | "CLOSED" | "LOST";
    temperature: "COLD" | "WARM" | "HOT";
    valueAmount: number;
    interest: string;
    summary: string;
    conversationStatus: "OPEN" | "WAITING_FOR_CUSTOMER" | "WAITING_FOR_HUMAN" | "CLOSED";
    subject: string;
    aiEnabled: boolean;
    handoffRequested?: boolean;
    lastMessageAt: Date;
    messages: { senderType: "CUSTOMER" | "AI" | "USER"; direction: "INBOUND" | "OUTBOUND"; text: string; createdAt: Date }[];
  };

  const leadSeeds: LeadSeed[] = [
    {
      name: "Анна Соколова",
      phone: "+7 916 100-20-30",
      source: "Instagram ads",
      channelType: "INSTAGRAM",
      status: "BOOKED",
      temperature: "HOT",
      valueAmount: 6500,
      interest: "Окрашивание и стрижка",
      summary: "Готова прийти в пятницу на окрашивание, слот уже согласован.",
      conversationStatus: "OPEN",
      subject: "Запись на окрашивание",
      aiEnabled: true,
      lastMessageAt: minutesAgo(2),
      messages: [
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Здравствуйте! Есть время на окрашивание на этой неделе?", createdAt: minutesAgo(42) },
        { senderType: "AI", direction: "OUTBOUND", text: "Здравствуйте! Да, подскажите, пожалуйста, окрашивание с уходом или только тонирование?", createdAt: minutesAgo(41) },
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Нужно сложное окрашивание и подровнять кончики.", createdAt: minutesAgo(38) },
        { senderType: "AI", direction: "OUTBOUND", text: "Могу предложить пятницу 16:00. Я подготовлю запись, но финально подтвердит администратор.", createdAt: minutesAgo(37) },
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Пятница 16:00 подходит, забронируйте, пожалуйста.", createdAt: minutesAgo(2) }
      ]
    },
    {
      name: "Дмитрий Орлов",
      phone: "+7 903 455-77-11",
      source: "Виджет сайта",
      channelType: "WEBSITE",
      status: "IN_PROGRESS",
      temperature: "WARM",
      valueAmount: 12000,
      interest: "Детейлинг салона автомобиля",
      summary: "Уточняет стоимость химчистки салона и ближайшие окна.",
      conversationStatus: "OPEN",
      subject: "Автосервис: химчистка салона",
      aiEnabled: true,
      lastMessageAt: minutesAgo(8),
      messages: [
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Сколько стоит химчистка салона седана?", createdAt: minutesAgo(25) },
        { senderType: "AI", direction: "OUTBOUND", text: "Обычно от 9 000 до 14 000 рублей, точная цена зависит от состояния салона. Могу передать мастеру фото для оценки.", createdAt: minutesAgo(24) },
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Фото отправлю вечером. Нужно сделать до выходных.", createdAt: minutesAgo(8) }
      ]
    },
    {
      name: "Елена Морозова",
      phone: "+7 921 700-10-10",
      source: "Telegram-бот",
      channelType: "TELEGRAM",
      status: "QUALIFIED",
      temperature: "HOT",
      valueAmount: 4200,
      interest: "Первичная консультация в клинике",
      summary: "Пациентка выбрала специалиста и просит подтвердить время.",
      conversationStatus: "WAITING_FOR_CUSTOMER",
      subject: "Клиника: консультация",
      aiEnabled: false,
      lastMessageAt: minutesAgo(24),
      messages: [
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Можно записаться к дерматологу на завтра?", createdAt: minutesAgo(61) },
        { senderType: "AI", direction: "OUTBOUND", text: "Я могу подобрать свободное окно. Это первичная консультация или повторный прием?", createdAt: minutesAgo(60) },
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Первичная консультация.", createdAt: minutesAgo(58) },
        { senderType: "USER", direction: "OUTBOUND", text: "Есть окно завтра в 15:00. Подтверждаем?", createdAt: minutesAgo(31) },
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Да, 15:00 удобно.", createdAt: minutesAgo(24) }
      ]
    },
    {
      name: "Игорь Лебедев",
      email: "igor.lebedev@example.com",
      source: "Email-кампания",
      channelType: "EMAIL",
      status: "SENT_TO_CRM",
      temperature: "WARM",
      valueAmount: 54000,
      interest: "Оптовый заказ расходников",
      summary: "B2B заявка с реквизитами отправлена в amoCRM.",
      conversationStatus: "CLOSED",
      subject: "E-commerce: B2B заказ",
      aiEnabled: false,
      lastMessageAt: minutesAgo(120),
      messages: [
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Нужен счет на 30 комплектов, работаем по безналу.", createdAt: minutesAgo(180) },
        { senderType: "AI", direction: "OUTBOUND", text: "Пришлите, пожалуйста, ИНН и контактный телефон. Я подготовлю заявку для менеджера.", createdAt: minutesAgo(179) },
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Реквизиты во вложении, телефон указал в подписи.", createdAt: minutesAgo(142) },
        { senderType: "USER", direction: "OUTBOUND", text: "Спасибо, заявка передана в amoCRM. Менеджер свяжется сегодня.", createdAt: minutesAgo(120) }
      ]
    },
    {
      name: "Ольга Кравцова",
      phone: "+7 985 234-55-90",
      source: "Рекомендация",
      channelType: "WHATSAPP",
      status: "NEW",
      temperature: "COLD",
      valueAmount: 3500,
      interest: "Маникюр",
      summary: "Новый лид спрашивает о воскресном графике.",
      conversationStatus: "WAITING_FOR_HUMAN",
      subject: "Салон: маникюр",
      aiEnabled: true,
      handoffRequested: true,
      lastMessageAt: minutesAgo(64),
      messages: [
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Вы работаете в воскресенье?", createdAt: minutesAgo(69) },
        { senderType: "AI", direction: "OUTBOUND", text: "Уточню расписание администратора. Обычно воскресенье доступно по предварительной записи.", createdAt: minutesAgo(68) },
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Мне нужен живой администратор, хочу уточнить мастера.", createdAt: minutesAgo(64) }
      ]
    },
    {
      name: "Павел Смирнов",
      email: "pavel.smirnov@example.com",
      source: "VK messages",
      channelType: "VK",
      status: "QUALIFIED",
      temperature: "WARM",
      valueAmount: 18000,
      interest: "Курс английского для команды",
      summary: "Интерес к корпоративному обучению, нужен расчет на 6 сотрудников.",
      conversationStatus: "OPEN",
      subject: "Образование: корпоративный курс",
      aiEnabled: true,
      lastMessageAt: minutesAgo(95),
      messages: [
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Подскажите стоимость английского для небольшой команды?", createdAt: minutesAgo(111) },
        { senderType: "AI", direction: "OUTBOUND", text: "Стоимость зависит от количества участников и целей. Сколько сотрудников планируете обучать?", createdAt: minutesAgo(110) },
        { senderType: "CUSTOMER", direction: "INBOUND", text: "6 человек, нужен разговорный английский для продаж.", createdAt: minutesAgo(95) }
      ]
    },
    {
      name: "Наталья Волкова",
      phone: "+7 911 778-12-34",
      source: "Call tracking",
      channelType: "PHONE",
      status: "BOOKED",
      temperature: "HOT",
      valueAmount: 9000,
      interest: "Ремонт стиральной машины",
      summary: "Сервисный выезд согласован на завтра.",
      conversationStatus: "WAITING_FOR_CUSTOMER",
      subject: "Сервис: ремонт техники",
      aiEnabled: true,
      lastMessageAt: minutesAgo(140),
      messages: [
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Машинка не сливает воду, нужен мастер.", createdAt: minutesAgo(170) },
        { senderType: "AI", direction: "OUTBOUND", text: "Понял. Могу предложить выезд завтра с 12:00 до 15:00. Подойдет?", createdAt: minutesAgo(169) },
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Подойдет, адрес отправила SMS.", createdAt: minutesAgo(140) }
      ]
    },
    {
      name: "Сергей Николаев",
      email: "sergey.nikolaev@example.com",
      source: "Виджет сайта",
      channelType: "WEBSITE",
      status: "ORDERED",
      temperature: "HOT",
      valueAmount: 32700,
      interest: "Заказ мебели",
      summary: "Заказ оформлен, нужно проверить оплату и доставку.",
      conversationStatus: "OPEN",
      subject: "E-commerce: заказ мебели",
      aiEnabled: true,
      lastMessageAt: minutesAgo(210),
      messages: [
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Хочу заказать стол и два стула, доставка в пределах МКАД.", createdAt: minutesAgo(260) },
        { senderType: "AI", direction: "OUTBOUND", text: "Я соберу заказ и передам менеджеру. Уточните, пожалуйста, цвет стола.", createdAt: minutesAgo(259) },
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Орех, как на фото. Оплатить можно по счету?", createdAt: minutesAgo(210) }
      ]
    },
    {
      name: "Марина Федорова",
      phone: "+7 999 321-44-66",
      source: "Instagram Direct",
      channelType: "INSTAGRAM",
      status: "IN_PROGRESS",
      temperature: "WARM",
      valueAmount: 7200,
      interest: "Диагностика в клинике",
      summary: "Нужна консультация администратора из-за медицинских уточнений.",
      conversationStatus: "WAITING_FOR_HUMAN",
      subject: "Клиника: диагностика",
      aiEnabled: true,
      handoffRequested: true,
      lastMessageAt: minutesAgo(260),
      messages: [
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Мне можно делать процедуру после операции?", createdAt: minutesAgo(270) },
        { senderType: "AI", direction: "OUTBOUND", text: "Я не могу давать медицинские рекомендации. Передам вопрос администратору, чтобы вас связали со специалистом.", createdAt: minutesAgo(269) },
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Хорошо, жду звонка.", createdAt: minutesAgo(260) }
      ]
    },
    {
      name: "Кирилл Антонов",
      phone: "+7 926 889-00-17",
      source: "Telegram-бот",
      channelType: "TELEGRAM",
      status: "LOST",
      temperature: "COLD",
      valueAmount: 4500,
      interest: "Замена масла",
      summary: "Лид выбрал другой сервис из-за срочного срока.",
      conversationStatus: "CLOSED",
      subject: "Автосервис: замена масла",
      aiEnabled: false,
      lastMessageAt: daysAgo(1),
      messages: [
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Нужно заменить масло сегодня до 18:00.", createdAt: daysAgo(1) },
        { senderType: "AI", direction: "OUTBOUND", text: "Сегодня свободных окон нет. Могу предложить завтра утром.", createdAt: daysAgo(1) },
        { senderType: "CUSTOMER", direction: "INBOUND", text: "Тогда не подойдет, спасибо.", createdAt: daysAgo(1) }
      ]
    }
  ];

  const createdLeads: Awaited<ReturnType<typeof prisma.lead.create>>[] = [];
  const conversations: Awaited<ReturnType<typeof prisma.conversation.create>>[] = [];

  for (const leadSeed of leadSeeds) {
    const lifecycleDates = {
      qualifiedAt: ["QUALIFIED", "BOOKED", "ORDERED", "SENT_TO_CRM", "CLOSED"].includes(leadSeed.status)
        ? leadSeed.lastMessageAt
        : null,
      bookedAt: leadSeed.status === "BOOKED" ? leadSeed.lastMessageAt : null,
      sentToCrmAt: leadSeed.status === "SENT_TO_CRM" ? leadSeed.lastMessageAt : null,
      closedAt: ["CLOSED", "LOST"].includes(leadSeed.status) ? leadSeed.lastMessageAt : null
    };

    const lead = await prisma.lead.create({
      data: {
        tenantId: tenant.id,
        name: leadSeed.name,
        phone: leadSeed.phone ?? null,
        email: leadSeed.email ?? null,
        source: leadSeed.source,
        channelType: leadSeed.channelType,
        status: leadSeed.status,
        temperature: leadSeed.temperature,
        valueAmount: leadSeed.valueAmount,
        interest: leadSeed.interest,
        summary: leadSeed.summary,
        assignedToUserId: user.id,
        lastMessageAt: leadSeed.lastMessageAt,
        ...lifecycleDates,
        customFields: {
          vertical: leadSeed.subject.split(":")[0] ?? "Demo",
          demo: true
        },
        createdAt: daysAgo(3),
        updatedAt: leadSeed.lastMessageAt
      }
    });
    createdLeads.push(lead);

    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        channelId: channelByType.get(leadSeed.channelType)?.id ?? null,
        status: leadSeed.conversationStatus,
        subject: leadSeed.subject,
        aiEnabled: leadSeed.aiEnabled,
        handoffRequested: leadSeed.handoffRequested ?? false,
        lastMessageAt: leadSeed.lastMessageAt,
        metadata: { demo: true },
        createdAt: leadSeed.messages[0]?.createdAt ?? daysAgo(3),
        updatedAt: leadSeed.lastMessageAt
      }
    });
    conversations.push(conversation);

    await prisma.message.createMany({
      data: leadSeed.messages.map((message) => ({
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: message.direction,
        senderType: message.senderType,
        senderUserId: message.senderType === "USER" ? user.id : null,
        text: message.text,
        status: message.direction === "INBOUND" ? "RECEIVED" : "DELIVERED",
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
        metadata: { demo: true }
      }))
    });

    await prisma.leadEvent.create({
      data: {
        tenantId: tenant.id,
        leadId: lead.id,
        type: "conversation_started",
        title: "Conversation started",
        message: leadSeed.summary,
        metadata: { channel: leadSeed.channelType },
        createdAt: leadSeed.messages[0]?.createdAt ?? daysAgo(3)
      }
    });
  }

  const annaId = createdLeads[0]?.id ?? null;
  const dmitryId = createdLeads[1]?.id ?? null;
  const elenaId = createdLeads[2]?.id ?? null;
  const igorId = createdLeads[3]?.id ?? null;
  const pavelId = createdLeads[5]?.id ?? null;
  const nataliaId = createdLeads[6]?.id ?? null;
  const sergeyId = createdLeads[7]?.id ?? null;
  const marinaId = createdLeads[8]?.id ?? null;

  await prisma.booking.createMany({
    data: [
      {
        tenantId: tenant.id,
        leadId: annaId,
        title: "Окрашивание и стрижка",
        startsAt: daysFromNow(2),
        endsAt: daysFromNow(2),
        status: "CONFIRMED",
        location: "Демо-компания, кабинет 2"
      },
      {
        tenantId: tenant.id,
        leadId: elenaId,
        title: "Первичная консультация",
        startsAt: daysFromNow(1),
        endsAt: daysFromNow(1),
        status: "DRAFT",
        location: "Клиника, кабинет 5"
      },
      {
        tenantId: tenant.id,
        leadId: nataliaId,
        title: "Выезд мастера",
        startsAt: daysFromNow(1),
        endsAt: daysFromNow(1),
        status: "CONFIRMED",
        location: "Адрес клиента"
      }
    ]
  });

  await prisma.order.createMany({
    data: [
      {
        tenantId: tenant.id,
        leadId: igorId,
        title: "Оптовый заказ расходников",
        status: "CONFIRMED",
        amount: 54000
      },
      {
        tenantId: tenant.id,
        leadId: sergeyId,
        title: "Стол и два стула",
        status: "DRAFT",
        amount: 32700
      }
    ]
  });

  await prisma.task.createMany({
    data: [
      {
        tenantId: tenant.id,
        leadId: dmitryId,
        assignedToUserId: user.id,
        title: "Запросить фото салона автомобиля",
        description: "Клиент хочет сделать химчистку до выходных.",
        priority: "HIGH",
        dueAt: daysFromNow(1)
      },
      {
        tenantId: tenant.id,
        leadId: marinaId,
        assignedToUserId: user.id,
        title: "Передать медицинский вопрос администратору",
        description: "AI корректно отказался от медицинского совета.",
        priority: "URGENT",
        dueAt: daysFromNow(1)
      },
      {
        tenantId: tenant.id,
        leadId: pavelId,
        assignedToUserId: user.id,
        title: "Подготовить расчет корпоративного курса",
        description: "6 сотрудников, разговорный английский для продаж.",
        priority: "NORMAL",
        dueAt: daysFromNow(2)
      }
    ]
  });

  const workflowSeeds = [
    { name: "Lead qualification", description: "Collect contact details, need, budget, and urgency.", status: "ACTIVE" },
    { name: "Booking appointment", description: "Offer available slots and create a booking draft.", status: "ACTIVE" },
    { name: "Order assistance", description: "Help collect product, delivery, and payment details.", status: "ACTIVE" },
    { name: "FAQ response", description: "Answer common questions with safe fallback rules.", status: "ACTIVE" },
    { name: "Follow-up", description: "Recover silent leads with polite reminders.", status: "PAUSED" },
    { name: "Send to CRM", description: "Package qualified leads and sync them to amoCRM.", status: "DRAFT" }
  ] as const;

  for (const workflowSeed of workflowSeeds) {
    await prisma.workflow.create({
      data: {
        tenantId: tenant.id,
        name: workflowSeed.name,
        description: workflowSeed.description,
        status: workflowSeed.status,
        businessType: "universal",
        version: 1,
        createdById: user.id,
        publishedAt: workflowSeed.status === "ACTIVE" ? daysAgo(2) : null,
        steps: {
          create: [
            {
              tenantId: tenant.id,
              type: "TRIGGER",
              name: "New customer message",
              positionX: 80,
              positionY: 120,
              config: { channel: "any" },
              nextStepIds: { next: ["qualify"] }
            },
            {
              tenantId: tenant.id,
              type: "QUESTION",
              name: "Collect key details",
              positionX: 320,
              positionY: 120,
              config: { requiredFields: ["name", "phone", "interest"] },
              nextStepIds: { next: ["ai-reply"] }
            },
            {
              tenantId: tenant.id,
              type: "AI_MESSAGE",
              name: "Safe AI reply",
              positionX: 560,
              positionY: 120,
              config: { tone: "friendly", safeFallback: true },
              nextStepIds: { next: ["action"] }
            },
            {
              tenantId: tenant.id,
              type: "ACTION",
              name: "Create event or handoff",
              positionX: 800,
              positionY: 120,
              config: { action: workflowSeed.name },
              nextStepIds: { next: ["end"] }
            },
            {
              tenantId: tenant.id,
              type: "END",
              name: "Done",
              positionX: 1040,
              positionY: 120,
              config: { success: true }
            }
          ]
        }
      }
    });
  }

  const integrationSeeds = [
    { provider: "AMOCRM", name: "amoCRM", category: "CRM", status: "CONNECTED", connectedAt: daysAgo(5), lastSyncAt: minutesAgo(120) },
    { provider: "BITRIX24", name: "Bitrix24", category: "CRM", status: "DISCONNECTED", connectedAt: null, lastSyncAt: null },
    { provider: "TELEGRAM", name: "Telegram", category: "Канал", status: "CONNECTED", connectedAt: daysAgo(4), lastSyncAt: minutesAgo(20) },
    { provider: "WHATSAPP_BUSINESS", name: "WhatsApp Business", category: "Канал", status: "DISCONNECTED", connectedAt: null, lastSyncAt: null },
    { provider: "INSTAGRAM", name: "Instagram", category: "Канал", status: "DISCONNECTED", connectedAt: null, lastSyncAt: null },
    { provider: "EMAIL", name: "Email", category: "Канал", status: "CONNECTED", connectedAt: daysAgo(6), lastSyncAt: minutesAgo(18) },
    { provider: "GOOGLE_CALENDAR", name: "Google Calendar", category: "Календарь", status: "CONNECTED", connectedAt: daysAgo(6), lastSyncAt: minutesAgo(70) },
    { provider: "SHOPIFY", name: "Shopify", category: "E-commerce", status: "DISCONNECTED", connectedAt: null, lastSyncAt: null },
    {
      provider: "WEBHOOK_API",
      name: "Webhook/API",
      category: "Разработчикам",
      status: "CONNECTED",
      connectedAt: daysAgo(7),
      lastSyncAt: minutesAgo(45)
    }
  ] as const;

  const integrations = await Promise.all(
    integrationSeeds.map((integration) =>
      prisma.integrationAccount.create({
        data: {
          tenantId: tenant.id,
          provider: integration.provider,
          name: integration.name,
          category: integration.category,
          status: integration.status,
          connectedAt: integration.connectedAt,
          lastSyncAt: integration.lastSyncAt,
          settings:
            integration.provider === "WEBHOOK_API"
              ? {
                  demo: true,
                  syncDirection: "inbound",
                  publicKey: "demo-generic-webhook",
                  endpoint: "/api/public/channels/webhook/demo-generic-webhook/events"
                }
              : { demo: true, syncDirection: "two-way" },
          scopes: ["read", "write"]
        }
      })
    )
  );

  for (const integration of integrations.filter((item) => item.status === "CONNECTED")) {
    await prisma.integrationSyncLog.create({
      data: {
        tenantId: tenant.id,
        integrationId: integration.id,
        action: "demo_sync",
        status: "SUCCESS",
        message: `${integration.name}: демо-синхронизация завершена.`,
        metadata: { records: 12 }
      }
    });
  }

  await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      planId: professionalPlan.id,
      status: "ACTIVE",
      periodStart: daysAgo(18),
      periodEnd: daysFromNow(12),
      metadata: { billingMode: "manual", demo: true }
    }
  });

  await prisma.usageCounter.create({
    data: {
      tenantId: tenant.id,
      periodStart: daysAgo(18),
      periodEnd: daysFromNow(12),
      aiConversations: 1248,
      messagesSent: 3920,
      messagesReceived: 4480,
      leadsCreated: createdLeads.length,
      bookingsCreated: 3,
      ordersCreated: 2,
      crmSyncs: 4,
      workflowRuns: 86
    }
  });

  await prisma.apiKey.create({
    data: {
      tenantId: tenant.id,
      name: "Demo widget key",
      keyPrefix: "lv_demo",
      keyHash: "sha256:demo-hash-not-a-real-secret",
      scopes: ["widget:read", "widget:write"]
    }
  });

  await prisma.onboardingState.create({
    data: {
      tenantId: tenant.id,
      currentStep: "launch",
      completedSteps: ["business", "channel", "scenario", "profile", "crm"],
      data: {
        businessType: "universal demo",
        firstChannel: "Виджет сайта",
        firstScenario: "Lead qualification"
      }
    }
  });

  await prisma.aiUsageLog.createMany({
    data: conversations.map((conversation, index) => ({
      tenantId: tenant.id,
      conversationId: conversation.id,
      leadId: conversation.leadId,
      provider: "mock",
      model: "leadvirt-local-mock",
      actionType: "generate_reply",
      inputTokens: 120 + index * 8,
      outputTokens: 64 + index * 4,
      estimatedCost: "0.000000",
      latencyMs: 42 + index,
      status: "SUCCESS",
      metadata: { demo: true },
      createdAt: conversation.lastMessageAt ?? now
    }))
  });

  await prisma.auditLog.createMany({
    data: [
      { tenantId: tenant.id, actorUserId: user.id, action: "seed.completed", entityType: "tenant", entityId: tenant.id, payload: { leads: createdLeads.length } },
      { tenantId: tenant.id, actorUserId: user.id, action: "lead.sent_to_crm", entityType: "lead", entityId: igorId, payload: { provider: "AMOCRM" }, createdAt: minutesAgo(120) },
      { tenantId: tenant.id, actorUserId: user.id, action: "booking.created", entityType: "lead", entityId: annaId, payload: { source: "AI" }, createdAt: minutesAgo(37) },
      { tenantId: tenant.id, actorUserId: user.id, action: "task.created", entityType: "lead", entityId: marinaId, payload: { priority: "URGENT" }, createdAt: minutesAgo(269) },
      { tenantId: tenant.id, actorUserId: user.id, action: "integration.connected", entityType: "integration", entityId: integrations[0]?.id ?? null, payload: { provider: "AMOCRM" }, createdAt: daysAgo(5) },
      { tenantId: tenant.id, actorUserId: user.id, action: "workflow.published", entityType: "workflow", payload: { name: "Lead qualification" }, createdAt: daysAgo(2) },
      { tenantId: tenant.id, actorUserId: user.id, action: "onboarding.step_completed", entityType: "onboarding", entityId: tenant.id, payload: { step: "crm" }, createdAt: daysAgo(1) }
    ]
  });

  await prisma.webhookEvent.create({
    data: {
      tenantId: tenant.id,
      provider: "website",
      externalEventId: "demo-widget-event-001",
      payloadHash: "demo-hash-001",
      payload: { event: "message.created", demo: true },
      status: "PROCESSED",
      receivedAt: minutesAgo(12),
      processedAt: minutesAgo(11)
    }
  });

  console.log(`Seeded ${tenant.name} with ${createdLeads.length} leads and ${conversations.length} conversations.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
