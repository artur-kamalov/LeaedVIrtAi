"use client";

import { Button, Card, StatusBadge } from "@leadvirt/ui";
import { Check, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { pricingPlans } from "@/features/mock/data";

export function PricingCards() {
  return (
    <div className="grid items-stretch gap-6 md:grid-cols-2 xl:grid-cols-4">
      {pricingPlans.map((plan, index) => (
        <motion.div
          key={plan.name}
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, delay: index * 0.08, ease: "easeOut" }}
          className={plan.popular ? "xl:-translate-y-3" : undefined}
        >
          <Card
            className={
              plan.popular
                ? "relative flex h-full flex-col overflow-visible border-emerald-400/40 bg-gradient-to-b from-emerald-500/10 to-zinc-900/60 p-6 shadow-[0_0_50px_rgba(52,211,153,0.15)]"
                : "relative flex h-full flex-col p-6"
            }
            hover
          >
            {plan.popular ? (
              <>
                <div className="absolute -top-px left-1/2 h-px w-2/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <StatusBadge tone="success">
                    <Sparkles className="mr-1.5 h-3 w-3" />
                    Популярный
                  </StatusBadge>
                </div>
              </>
            ) : null}

            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold tracking-tight text-zinc-50">{plan.name}</h3>
                <p className="mt-2 min-h-10 text-sm leading-5 text-zinc-400">{plan.bestFor}</p>
              </div>
            </div>

            <div className="mb-6 mt-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-bold tracking-tight text-zinc-50">{plan.price}</span>
              </div>
              <span className="text-sm text-zinc-500">{plan.note}</span>
            </div>

            <Button className="mb-8 w-full" variant={plan.popular ? "primary" : "outline"}>
              Попробовать
            </Button>

            <ul className="mt-auto space-y-3">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm">
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                      plan.popular ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5 text-zinc-400"
                    }`}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                  <span className="text-zinc-300">{feature}</span>
                </li>
              ))}
            </ul>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
