"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { useState } from "react";
import {
  DURATION,
  EASE_EMPHASIZED_DECELERATE,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useMotionSafe,
} from "@leadforge/ui";

export interface FeatureTab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  title: string;
  body: React.ReactNode;
  points?: string[];
  visual: React.ReactNode;
}

/**
 * Tabbed feature switcher: a pill tab list whose tonal indicator slides between tabs (spring,
 * transform only), with the panel crossfading. Radix Tabs keyboard model.
 */
export function FeatureTabs({ tabs, label }: { tabs: FeatureTab[]; label: string }) {
  const [value, setValue] = useState(tabs[0]?.id ?? "");
  const motionSafe = useMotionSafe();

  return (
    <Tabs value={value} onValueChange={setValue} className="flex min-w-0 flex-col gap-8 sm:gap-10">
      <div className="flex min-w-0 justify-start sm:justify-center">
        <TabsList variant="pill" aria-label={label}>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="h-11 px-4 sm:px-5">
              {tab.icon}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id} className="mt-0 focus-visible:outline-offset-4">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab.id}
              initial={motionSafe ? { opacity: 0, y: 16 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DURATION.medium, ease: EASE_EMPHASIZED_DECELERATE }}
              className="grid min-w-0 grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16"
            >
              <div className="flex min-w-0 flex-col gap-4">
                <h3 className="text-h3">{tab.title}</h3>
                <div className="text-body-lg text-muted-foreground">{tab.body}</div>
                {tab.points ? (
                  <ul className="mt-2 flex flex-col gap-3">
                    {tab.points.map((p) => (
                      <li key={p} className="flex min-w-0 items-start gap-3 text-sm">
                        <span className="bg-primary-container text-primary-container-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full">
                          <Check aria-hidden className="size-3.5" strokeWidth={3} />
                        </span>
                        <span className="min-w-0">{p}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="bg-surface-container-high/70 dark:bg-surface-container min-w-0 rounded-[24px] p-1.5 sm:rounded-[32px] sm:p-2.5">
                <div className="bg-surface overflow-hidden rounded-[18px] sm:rounded-[24px]">
                  {tab.visual}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </TabsContent>
      ))}
    </Tabs>
  );
}
