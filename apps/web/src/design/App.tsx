import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { NavProvider, useNav } from "./product/nav";
import { ThemeProvider } from "./product/theme";
import { LandingPage } from "./components/LandingPage";
import { OnboardingPage } from "./product/pages/OnboardingPage";
import { DashboardPage } from "./product/pages/DashboardPage";
import { InboxPage } from "./product/pages/InboxPage";
import { ConversationPage } from "./product/pages/ConversationPage";
import { PipelinePage } from "./product/pages/PipelinePage";
import { AutomationPage } from "./product/pages/AutomationPage";
import { AnalyticsPage } from "./product/pages/AnalyticsPage";
import { IntegrationsPage } from "./product/pages/IntegrationsPage";
import { SettingsPage } from "./product/pages/SettingsPage";

function Router() {
  const { route } = useNav();

  const screen = (() => {
    switch (route) {
      case "landing":
        return <LandingPage />;
      case "onboarding":
        return <OnboardingPage />;
      case "dashboard":
        return <DashboardPage />;
      case "inbox":
        return <InboxPage />;
      case "conversation":
        return <ConversationPage />;
      case "pipeline":
        return <PipelinePage />;
      case "automation":
        return <AutomationPage />;
      case "analytics":
        return <AnalyticsPage />;
      case "integrations":
        return <IntegrationsPage />;
      case "settings":
        return <SettingsPage />;
      default:
        return <LandingPage />;
    }
  })();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={route}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
      >
        {screen}
      </motion.div>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <NavProvider>
        <Router />
      </NavProvider>
    </ThemeProvider>
  );
}
