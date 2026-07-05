import React, { useState } from "react";
import { ProductLayout } from "../ProductLayout";
import { Card } from "../shared";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { ConfirmDialog, Tip, Select as BrandSelect } from "../ui";
import { toast } from "sonner";
import {
  MessageCircle,
  Bot,
  ListChecks,
  GitBranch,
  CalendarCheck,
  Repeat,
  Database,
  GripVertical,
  Plus,
  Trash2,
  Play,
  Save,
  ToggleLeft,
  ToggleRight,
  X,
  Info,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type BlockType = "trigger" | "ai" | "qualify" | "condition" | "booking" | "followup" | "crm";

interface WorkflowBlock {
  id: string;
  type: BlockType;
  title: string;
  subtitle: string;
  icon: React.ElementType;
  accent: string;
  glowColor: string;
  enabled: boolean;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const SCENARIOS = ["Запись на услугу", "Оформление заказа", "Возврат клиента"];

const INITIAL_BLOCKS: WorkflowBlock[] = [
  {
    id: "trigger",
    type: "trigger",
    title: "Триггер: Новое сообщение",
    subtitle: "Клиент пишет в любой канал",
    icon: MessageCircle,
    accent: "from-violet-500 to-indigo-500",
    glowColor: "rgba(139,92,246,0.35)",
    enabled: true,
  },
  {
    id: "greeting",
    type: "ai",
    title: "AI-приветствие",
    subtitle: "Персональное приветствие и сбор контекста",
    icon: Bot,
    accent: "from-emerald-500 to-teal-500",
    glowColor: "rgba(16,185,129,0.35)",
    enabled: true,
  },
  {
    id: "qualify",
    type: "qualify",
    title: "Квалификация",
    subtitle: "AI задаёт уточняющие вопросы",
    icon: ListChecks,
    accent: "from-sky-500 to-blue-500",
    glowColor: "rgba(14,165,233,0.35)",
    enabled: true,
  },
  {
    id: "condition",
    type: "condition",
    title: "Условие",
    subtitle: "Целевой лид?",
    icon: GitBranch,
    accent: "from-amber-500 to-orange-500",
    glowColor: "rgba(245,158,11,0.35)",
    enabled: true,
  },
  {
    id: "booking",
    type: "booking",
    title: "Запись / Заказ",
    subtitle: "Бронирование времени или оформление заказа",
    icon: CalendarCheck,
    accent: "from-emerald-500 to-green-500",
    glowColor: "rgba(16,185,129,0.35)",
    enabled: true,
  },
  {
    id: "followup",
    type: "followup",
    title: "Повторное касание",
    subtitle: "Напоминание через 24ч если нет ответа",
    icon: Repeat,
    accent: "from-rose-500 to-pink-500",
    glowColor: "rgba(244,63,94,0.35)",
    enabled: true,
  },
  {
    id: "crm",
    type: "crm",
    title: "Отправка в CRM",
    subtitle: "Структурированный лид уходит в amoCRM",
    icon: Database,
    accent: "from-teal-500 to-cyan-500",
    glowColor: "rgba(20,184,166,0.35)",
    enabled: true,
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function DarkInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "w-full bg-white/5 border border-white/8 rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all",
        className
      )}
    />
  );
}

function DarkTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full bg-white/5 border border-white/8 rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all resize-none"
    />
  );
}

function DarkSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <BrandSelect
      value={value}
      onValueChange={onChange}
      options={options.map((o) => ({ value: o.value, label: o.label }))}
      className="h-10"
    />
  );
}

function MiniToggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={cn(
        "relative w-8 h-4.5 rounded-full transition-colors duration-200 flex-shrink-0",
        checked ? "bg-emerald-500" : "bg-white/10"
      )}
      style={{ height: "18px" }}
    >
      <span
        className={cn(
          "absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all duration-200 shadow-sm",
          checked ? "left-[calc(100%-14px-2px)]" : "left-0.5"
        )}
      />
    </button>
  );
}

// Animated connector between blocks
function Connector({ index }: { index: number }) {
  return (
    <div className="flex flex-col items-center relative" style={{ height: 48 }}>
      {/* Static gradient line */}
      <div className="w-px flex-1 bg-gradient-to-b from-emerald-500/30 to-emerald-500/10 relative overflow-hidden">
        {/* Traveling pulse */}
        <motion.div
          className="absolute w-full"
          style={{
            height: 24,
            background: "linear-gradient(to bottom, transparent, #10b981, transparent)",
          }}
          animate={{ top: ["-24px", "calc(100% + 24px)"] }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
            ease: "linear",
            delay: index * 0.28,
          }}
        />
      </div>
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

function GreetingSettings() {
  const [text, setText] = useState("Привет, {{имя}}! Я AI-ассистент. Чем могу помочь?");
  const [tone, setTone] = useState("friendly");
  const [delay, setDelay] = useState("1");
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Текст приветствия</label>
        <DarkTextarea value={text} onChange={setText} rows={4} />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Тон общения</label>
        <DarkSelect
          value={tone}
          onChange={setTone}
          options={[
            { label: "Дружелюбный", value: "friendly" },
            { label: "Деловой", value: "business" },
            { label: "Нейтральный", value: "neutral" },
          ]}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Задержка ответа (сек)</label>
        <DarkInput value={delay} onChange={setDelay} placeholder="1" />
      </div>
    </div>
  );
}

function QualifySettings() {
  const [questions, setQuestions] = useState([
    "Какая услуга вас интересует?",
    "Когда планируете начать?",
    "Каков ваш бюджет?",
  ]);
  const [newQ, setNewQ] = useState("");
  return (
    <div className="space-y-4">
      <label className="text-xs font-medium text-zinc-400">Вопросы для квалификации</label>
      <div className="space-y-2">
        {questions.map((q, i) => (
          <div key={i} className="flex gap-2 items-center">
            <span className="text-xs text-zinc-500 w-4 flex-shrink-0">{i + 1}.</span>
            <div className="flex-1 bg-white/5 border border-white/8 rounded-xl px-3 py-2 text-sm text-zinc-200">
              {q}
            </div>
            <button
              onClick={() => setQuestions((prev) => prev.filter((_, j) => j !== i))}
              className="text-zinc-600 hover:text-rose-400 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <DarkInput value={newQ} onChange={setNewQ} placeholder="Новый вопрос..." />
        <button
          onClick={() => {
            if (newQ.trim()) {
              setQuestions((prev) => [...prev, newQ.trim()]);
              setNewQ("");
            }
          }}
          className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition-all flex-shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Макс. вопросов подряд</label>
        <DarkInput value="3" onChange={() => {}} />
      </div>
    </div>
  );
}

function ConditionSettings() {
  const [rules, setRules] = useState([
    { field: "бюджет", op: "gt", value: "5000" },
    { field: "интерес", op: "eq", value: "высокий" },
  ]);
  return (
    <div className="space-y-4">
      <label className="text-xs font-medium text-zinc-400">Условия (все должны совпасть)</label>
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <DarkInput value={r.field} onChange={(v) => setRules((prev) => prev.map((x, j) => j === i ? { ...x, field: v } : x))} className="flex-1 min-w-0" />
            <DarkSelect
              value={r.op}
              onChange={(v) => setRules((prev) => prev.map((x, j) => j === i ? { ...x, op: v } : x))}
              options={[
                { label: ">", value: "gt" },
                { label: "=", value: "eq" },
                { label: "<", value: "lt" },
                { label: "содержит", value: "contains" },
              ]}
            />
            <DarkInput value={r.value} onChange={(v) => setRules((prev) => prev.map((x, j) => j === i ? { ...x, value: v } : x))} className="flex-1 min-w-0" />
            <button onClick={() => setRules((prev) => prev.filter((_, j) => j !== i))} className="text-zinc-600 hover:text-rose-400 transition-colors flex-shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => setRules((prev) => [...prev, { field: "", op: "eq", value: "" }])}
        className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
      >
        <Plus className="w-3 h-3" /> Добавить условие
      </button>
    </div>
  );
}

function BookingSettings() {
  const [calendar, setCalendar] = useState("google");
  const [confirm, setConfirm] = useState(true);
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Система бронирования</label>
        <DarkSelect
          value={calendar}
          onChange={setCalendar}
          options={[
            { label: "Google Calendar", value: "google" },
            { label: "Yclients", value: "yclients" },
            { label: "Кастомная ссылка", value: "custom" },
          ]}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Шаблон подтверждения</label>
        <DarkTextarea value="Запись оформлена на {{дата}} в {{время}}. До встречи!" onChange={() => {}} rows={3} />
      </div>
      <div className="flex items-center justify-between py-1">
        <span className="text-xs text-zinc-400">Запрос подтверждения</span>
        <MiniToggle checked={confirm} onChange={() => setConfirm((v) => !v)} />
      </div>
    </div>
  );
}

function FollowupSettings() {
  const [delay, setDelay] = useState("24");
  const [maxAttempts, setMaxAttempts] = useState("2");
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Задержка напоминания (часов)</label>
        <DarkInput value={delay} onChange={setDelay} />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Макс. попыток</label>
        <DarkInput value={maxAttempts} onChange={setMaxAttempts} />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Текст напоминания</label>
        <DarkTextarea value="{{имя}}, вы ещё думаете? Готов ответить на вопросы!" onChange={() => {}} rows={3} />
      </div>
    </div>
  );
}

function CrmSettings() {
  const [system, setSystem] = useState("amocrm");
  const [pipeline, setPipeline] = useState("Новые лиды");
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">CRM-система</label>
        <DarkSelect
          value={system}
          onChange={setSystem}
          options={[
            { label: "amoCRM", value: "amocrm" },
            { label: "Битрикс24", value: "bitrix" },
            { label: "HubSpot", value: "hubspot" },
          ]}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Воронка</label>
        <DarkInput value={pipeline} onChange={setPipeline} placeholder="Новые лиды" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Поля для передачи</label>
        {["Имя", "Телефон", "Источник", "Бюджет", "Запрос"].map((field) => (
          <div key={field} className="flex items-center justify-between py-0.5">
            <span className="text-xs text-zinc-300">{field}</span>
            <MiniToggle checked={true} onChange={() => {}} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TriggerSettings() {
  const [channels, setChannels] = useState({ telegram: true, whatsapp: true, instagram: false, web: true });
  return (
    <div className="space-y-4">
      <label className="text-xs font-medium text-zinc-400">Активные каналы</label>
      {(Object.entries(channels) as [keyof typeof channels, boolean][]).map(([ch, val]) => (
        <div key={ch} className="flex items-center justify-between">
          <span className="text-sm text-zinc-200 capitalize">{ch === "web" ? "Web-чат" : ch.charAt(0).toUpperCase() + ch.slice(1)}</span>
          <MiniToggle checked={val} onChange={() => setChannels((prev) => ({ ...prev, [ch]: !prev[ch] }))} />
        </div>
      ))}
      <div className="space-y-1.5 mt-2">
        <label className="text-xs font-medium text-zinc-400">Фильтр по ключевым словам</label>
        <DarkInput value="" onChange={() => {}} placeholder="Оставьте пустым для всех сообщений" />
      </div>
    </div>
  );
}

function BlockSettings({ block, onDelete }: { block: WorkflowBlock; onDelete: () => void }) {
  const settingsMap: Record<BlockType, React.ReactNode> = {
    trigger: <TriggerSettings />,
    ai: <GreetingSettings />,
    qualify: <QualifySettings />,
    condition: <ConditionSettings />,
    booking: <BookingSettings />,
    followup: <FollowupSettings />,
    crm: <CrmSettings />,
  };

  return (
    <div className="space-y-5">
      {settingsMap[block.type]}

      {/* Variables hint */}
      <div className="flex items-start gap-2 p-3 rounded-xl bg-white/3 border border-white/5">
        <Info className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-zinc-500 leading-relaxed">
          Используйте <span className="text-emerald-400 font-mono">{"{{переменная}}"}</span> для подстановки данных:{" "}
          <span className="text-zinc-400">имя, телефон, источник, бюджет, дата</span>
        </p>
      </div>

      {/* Delete */}
      {block.type !== "trigger" && (
        <button
          onClick={onDelete}
          className="flex items-center gap-2 text-xs text-rose-500 hover:text-rose-400 transition-colors group"
        >
          <Trash2 className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
          Удалить блок
        </button>
      )}
    </div>
  );
}

// ─── Block Node Card ──────────────────────────────────────────────────────────

function BlockNode({
  block,
  selected,
  onClick,
  onToggle,
}: {
  block: WorkflowBlock;
  selected: boolean;
  onClick: () => void;
  onToggle: () => void;
}) {
  const Icon = block.icon;
  const isCondition = block.type === "condition";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <div
        onClick={onClick}
        className={cn(
          "relative cursor-pointer rounded-2xl border p-4 transition-all duration-300 group",
          "bg-zinc-900/60 backdrop-blur-sm",
          selected
            ? "border-emerald-500/50 shadow-[0_0_24px_rgba(16,185,129,0.18)]"
            : "border-white/5 hover:border-white/12"
        )}
      >
        {/* Selected glow */}
        {selected && (
          <motion.div
            className="absolute inset-0 rounded-2xl pointer-events-none"
            style={{ background: "radial-gradient(ellipse at center, rgba(16,185,129,0.06) 0%, transparent 70%)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          />
        )}

        <div className="flex items-center gap-3 relative z-10">
          {/* Drag handle */}
          <Tip content="Перетащить блок">
            <span className="cursor-grab active:cursor-grabbing">
              <GripVertical className="w-4 h-4 text-zinc-600 group-hover:text-zinc-500 flex-shrink-0 transition-colors" />
            </span>
          </Tip>

          {/* Icon */}
          <div
            className={cn(
              "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0",
              `bg-gradient-to-br ${block.accent}`,
              "shadow-lg"
            )}
          >
            <Icon className="w-4.5 h-4.5 text-white" style={{ width: 18, height: 18 }} />
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-100 leading-snug truncate">{block.title}</p>
            <p className="text-xs text-zinc-500 truncate mt-0.5">{block.subtitle}</p>
          </div>

          {/* Toggle */}
          <Tip content={block.enabled ? "Выключить блок" : "Включить блок"}>
            <div className="flex-shrink-0" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
              <MiniToggle checked={block.enabled} onChange={onToggle} />
            </div>
          </Tip>
        </div>

        {/* Condition branches */}
        {isCondition && (
          <div className="flex gap-3 mt-3 pl-[52px] relative z-10">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-xs text-emerald-400 font-medium">Да</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              <span className="text-xs text-rose-400 font-medium">Нет</span>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AutomationPage() {
  const [blocks, setBlocks] = useState<WorkflowBlock[]>(INITIAL_BLOCKS);
  const [selectedId, setSelectedId] = useState<string>("trigger");
  const [scenarioActive, setScenarioActive] = useState(true);
  const [activeScenario, setActiveScenario] = useState(0);
  const [scenarioName, setScenarioName] = useState(SCENARIOS[0]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const selectedBlock = blocks.find((b) => b.id === selectedId) ?? blocks[0];

  const toggleBlock = (id: string) => {
    setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, enabled: !b.enabled } : b));
  };

  const requestDeleteBlock = (id: string) => {
    setPendingDeleteId(id);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteBlock = () => {
    if (!pendingDeleteId) return;
    setBlocks((prev) => prev.filter((b) => b.id !== pendingDeleteId));
    setSelectedId("trigger");
    setPendingDeleteId(null);
    toast.success("Блок удалён");
  };

  const addBlock = () => {
    const newBlock: WorkflowBlock = {
      id: `block-${Date.now()}`,
      type: "ai",
      title: "Новый блок",
      subtitle: "Настройте действие",
      icon: Bot,
      accent: "from-emerald-500 to-teal-500",
      glowColor: "rgba(16,185,129,0.35)",
      enabled: true,
    };
    setBlocks((prev) => [...prev, newBlock]);
    setSelectedId(newBlock.id);
    toast("Блок добавлен");
  };

  return (
    <ProductLayout title="Автоматизация">
      <div className="h-full flex flex-col gap-0 min-h-0">
        {/* ── Toolbar ── */}
        <div className="flex flex-col gap-3 mb-5 flex-shrink-0">
          {/* Scenario tabs */}
          <div className="flex gap-2 flex-wrap">
            {SCENARIOS.map((s, i) => (
              <button
                key={i}
                onClick={() => { setActiveScenario(i); setScenarioName(s); }}
                className={cn(
                  "px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all duration-200 border",
                  i === activeScenario
                    ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                    : "bg-white/3 border-white/6 text-zinc-400 hover:text-zinc-200 hover:border-white/12"
                )}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Main toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
            <input
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              className="flex-1 min-w-[180px] bg-transparent border-b border-white/10 pb-0.5 text-base font-bold text-zinc-100 tracking-tight outline-none focus:border-emerald-500/50 transition-colors placeholder-zinc-600"
            />

            {/* Active toggle */}
            <Tip content={scenarioActive ? "Выключить сценарий" : "Включить сценарий"}>
              <button
                onClick={() => {
                  const next = !scenarioActive;
                  setScenarioActive(next);
                  toast(next ? "Сценарий включён" : "Сценарий выключен");
                }}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all duration-200",
                  scenarioActive
                    ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                    : "bg-white/4 border-white/8 text-zinc-500"
                )}
              >
                {scenarioActive ? (
                  <ToggleRight className="w-4 h-4" />
                ) : (
                  <ToggleLeft className="w-4 h-4" />
                )}
                {scenarioActive ? "Активен" : "Выключен"}
              </button>
            </Tip>

            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => toast("Запускаю тест...", { description: "AI пройдёт сценарий на тестовом диалоге" })}>
              <Play className="w-3.5 h-3.5" />
              Тест
            </Button>
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => toast.success("Сценарий сохранён")}>
              <Save className="w-3.5 h-3.5" />
              Сохранить
            </Button>
          </div>
        </div>

        {/* ── Main layout ── */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 overflow-hidden">
          {/* ── LEFT: Canvas ── */}
          <div className="overflow-y-auto pr-1 scrollbar-thin">
            <div className="max-w-lg mx-auto pb-8">
              <AnimatePresence mode="popLayout">
                {blocks.map((block, index) => (
                  <React.Fragment key={block.id}>
                    <BlockNode
                      block={block}
                      selected={selectedId === block.id}
                      onClick={() => setSelectedId(block.id)}
                      onToggle={() => toggleBlock(block.id)}
                    />
                    {index < blocks.length - 1 && <Connector index={index} />}
                  </React.Fragment>
                ))}
              </AnimatePresence>

              {/* Add block button */}
              <motion.div
                className="mt-4 flex justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                <button
                  onClick={addBlock}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-2xl border border-dashed border-white/12 text-sm text-zinc-500 hover:text-zinc-300 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all duration-200 group"
                >
                  <Plus className="w-4 h-4 group-hover:text-emerald-400 transition-colors" />
                  Добавить блок
                </button>
              </motion.div>
            </div>
          </div>

          {/* ── RIGHT: Settings panel ── */}
          <div className="overflow-y-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedId}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <Card className="rounded-2xl border border-white/5 bg-zinc-900/50 backdrop-blur p-5">
                  {/* Panel header */}
                  <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/5">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0",
                        `bg-gradient-to-br ${selectedBlock.accent}`
                      )}
                    >
                      {React.createElement(selectedBlock.icon, { className: "w-4 h-4 text-white" })}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-100 truncate">{selectedBlock.title}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">Настройки блока</p>
                    </div>
                  </div>

                  <BlockSettings
                    block={selectedBlock}
                    onDelete={() => requestDeleteBlock(selectedBlock.id)}
                  />
                </Card>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Удалить блок?"
        description="Это действие нельзя отменить."
        danger
        confirmLabel="Удалить"
        onConfirm={confirmDeleteBlock}
      />
    </ProductLayout>
  );
}
