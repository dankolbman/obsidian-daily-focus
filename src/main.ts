import { Plugin, Notice, TFile } from "obsidian";
import { DailyFocusSettings, DEFAULT_SETTINGS, DailyFocusSettingTab } from "./settings";
import { ContextGatherer } from "./services/context-gatherer";
import { LLMService } from "./services/llm-service";
import { FocusPromptModal } from "./modals/focus-prompt-modal";
import { MeetingPromptModal } from "./modals/meeting-prompt-modal";
import { StatusUpdateModal } from "./modals/status-update-modal";
import { DraftReviewModal } from "./modals/draft-review-modal";
import { CheckinModal } from "./modals/checkin-modal";
import { EODCheckinModal } from "./modals/eod-checkin-modal";
import { CheckinSelectorModal } from "./modals/checkin-selector-modal";
import {
  mergeDraftWithResolutions,
  renderStatusTables,
  parseMarkdownToAgenda,
} from "./utils/markdown-utils";
import { getTodayDate } from "./utils/date-utils";
import { EnhancedContext } from "./types";

/**
 * Get the Electron Notification class if available.
 * Obsidian runs in Electron, so we can access native notifications.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getElectronNotification(): any {
  try {
    // In newer Electron/Obsidian, remote is accessed differently
    const electron = require("electron");
    if (electron.remote?.Notification) {
      return electron.remote.Notification;
    }
    // Direct access in main process or newer versions
    if (electron.Notification) {
      return electron.Notification;
    }
  } catch {
    // Electron not available
  }
  return null;
}

export default class DailyFocusPlugin extends Plugin {
  settings: DailyFocusSettings = DEFAULT_SETTINGS;
  private scheduledCheck: number | null = null;
  private contextGatherer: ContextGatherer | null = null;
  private llmService: LLMService | null = null;

  // Track notification state for each check-in type
  private notificationState = {
    morning: { lastNotified: null as string | null, completed: false, lastReminderTime: 0 },
    midday: { lastNotified: null as string | null, completed: false, lastReminderTime: 0 },
    eod: { lastNotified: null as string | null, completed: false, lastReminderTime: 0 },
  };

  async onload() {
    await this.loadSettings();

    // Initialize services
    this.contextGatherer = new ContextGatherer(this.app);
    this.configureIntegrations();

    this.llmService = new LLMService({
      provider: this.settings.llmProvider,
      apiKey: this.settings.anthropicApiKey,
      model: this.settings.model,
      cliPath: this.settings.cliPath,
    });

    // Add ribbon icon
    this.addRibbonIcon("target", "Daily Focus: Select Check-in", async () => {
      await this.showCheckinSelector();
    });

    // Add command
    this.addCommand({
      id: "select-checkin",
      name: "Select Check-in Type",
      callback: async () => {
        await this.showCheckinSelector();
      },
    });

    this.addCommand({
      id: "generate-daily-focus",
      name: "Generate Daily Focus",
      callback: async () => {
        await this.generateDailyFocus();
      },
    });

    // Add check-in command
    this.addCommand({
      id: "midday-checkin",
      name: "Mid-day Check-in",
      callback: async () => {
        await this.runCheckin();
      },
    });

    // Add end-of-day command
    this.addCommand({
      id: "eod-checkin",
      name: "End of Day Wrap-up",
      callback: async () => {
        await this.runEODCheckin();
      },
    });

    // Add settings tab
    this.addSettingTab(new DailyFocusSettingTab(this.app, this));

    // Schedule notification if configured
    this.scheduleNotification();
  }

  /**
   * Configure GitHub and Jira integrations based on settings.
   */
  private configureIntegrations(): void {
    if (!this.contextGatherer) return;

    const config = {
      enableGitHub: this.settings.enableGitHub,
      enableJira: this.settings.enableJira,
      github: {
        repo: this.settings.githubRepo,
        cliPath: this.settings.ghCliPath,
      },
      jira: {
        projectKey: this.settings.jiraProjectKey,
        baseUrl: this.settings.jiraBaseUrl,
        cliPath: this.settings.jiraCliPath,
      },
    };

    console.log("[DailyFocus] Configuring integrations:", config);
    this.contextGatherer.setIntegrationConfig(config);
  }

  onunload() {
    if (this.scheduledCheck !== null) {
      window.clearInterval(this.scheduledCheck);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Update LLM service with new settings
    if (this.llmService) {
      this.llmService.setConfig({
        provider: this.settings.llmProvider,
        apiKey: this.settings.anthropicApiKey,
        model: this.settings.model,
        cliPath: this.settings.cliPath,
      });
    }
    // Update integrations
    this.configureIntegrations();
    // Reschedule notification when settings change
    this.scheduleNotification();
  }

  private scheduleNotification() {
    // Clear existing schedule
    if (this.scheduledCheck !== null) {
      window.clearInterval(this.scheduledCheck);
      this.scheduledCheck = null;
    }

    const hasMorningNotification = !!this.settings.notificationTime;
    const hasMiddayNotification = !!this.settings.checkinTime;
    const hasEODNotification = !!this.settings.endOfDayTime;

    if (!hasMorningNotification && !hasMiddayNotification && !hasEODNotification) {
      return;
    }

    // Reset completion flags at midnight
    const today = getTodayDate();
    if (this.notificationState.morning.lastNotified !== today) {
      this.notificationState.morning.completed = false;
      this.notificationState.morning.lastReminderTime = 0;
    }
    if (this.notificationState.midday.lastNotified !== today) {
      this.notificationState.midday.completed = false;
      this.notificationState.midday.lastReminderTime = 0;
    }
    if (this.notificationState.eod.lastNotified !== today) {
      this.notificationState.eod.completed = false;
      this.notificationState.eod.lastReminderTime = 0;
    }

    const reminderIntervalMs = this.settings.reminderInterval * 60 * 1000;

    // Check every minute if it's time to trigger
    this.scheduledCheck = window.setInterval(() => {
      const now = new Date();
      const todayStr = getTodayDate();
      const currentTime = now.getTime();

      // Helper to check if it's time for initial or follow-up notification
      const checkNotification = (
        timeStr: string,
        state: { lastNotified: string | null; completed: boolean; lastReminderTime: number },
        title: string,
        initialMessage: string,
        reminderMessage: string
      ) => {
        const [hours, minutes] = timeStr.split(":").map(Number);
        const scheduledTime = new Date();
        scheduledTime.setHours(hours, minutes, 0, 0);

        // Only trigger if we're past the scheduled time
        if (now < scheduledTime) return;

        // If already completed today, skip
        if (state.completed && state.lastNotified === todayStr) return;

        // Initial notification
        if (state.lastNotified !== todayStr) {
          if (now.getHours() === hours && now.getMinutes() === minutes) {
            state.lastNotified = todayStr;
            state.lastReminderTime = currentTime;
            this.sendNotification(title, initialMessage);
          }
          return;
        }

        // Follow-up reminder (if not completed and interval has passed)
        if (!state.completed && currentTime - state.lastReminderTime >= reminderIntervalMs) {
          state.lastReminderTime = currentTime;
          this.sendNotification(title + " (Reminder)", reminderMessage);
        }
      };

      // Morning notification
      if (hasMorningNotification) {
        checkNotification(
          this.settings.notificationTime,
          this.notificationState.morning,
          "Daily Focus",
          "Time to plan your day! Click to open Obsidian.",
          "Don't forget to plan your day!"
        );
      }

      // Mid-day check-in notification
      if (hasMiddayNotification) {
        checkNotification(
          this.settings.checkinTime,
          this.notificationState.midday,
          "Mid-day Check-in",
          "How's your day going? Time for a quick progress update.",
          "Quick check-in reminder—how's your day going?"
        );
      }

      // End-of-day notification
      if (hasEODNotification) {
        checkNotification(
          this.settings.endOfDayTime,
          this.notificationState.eod,
          "End of Day Wrap-up",
          "Time to wrap up your day and reflect.",
          "Reminder: Take a moment to wrap up your day."
        );
      }
    }, 60000);

    this.registerInterval(this.scheduledCheck);
  }

  /**
   * Mark a check-in type as completed (stops reminders).
   */
  private markCheckinComplete(type: "morning" | "midday" | "eod") {
    this.notificationState[type].completed = true;
    console.log(`[DailyFocus] ${type} check-in marked complete`);
  }

  /**
   * Send an OS-level notification with fallback to in-app notice.
   */
  sendNotification(title: string, body: string): void {
    const ElectronNotification = getElectronNotification();

    // Try OS-level notification first
    if (ElectronNotification && ElectronNotification.isSupported()) {
      try {
        const notification = new ElectronNotification({
          title: title,
          body: body,
          silent: false,
        });

        // When clicked, focus Obsidian window
        notification.on("click", () => {
          try {
            const electron = require("electron");
            const win = electron.remote?.getCurrentWindow?.();
            if (win) {
              if (win.isMinimized()) win.restore();
              win.focus();
            }
          } catch {
            // Focus failed, but notification worked
          }
        });

        notification.show();
        console.log("[DailyFocus] OS notification sent successfully");
        return;
      } catch (error) {
        console.warn("[DailyFocus] OS notification failed, falling back to in-app:", error);
      }
    }

    // Fallback to in-app notification
    new Notice(`${title}: ${body}`, 10000);
    console.log("[DailyFocus] Sent in-app notification (OS notifications not available)");
  }

  /**
   * Test the notification system. Called from settings.
   */
  testNotification(): void {
    this.sendNotification("Daily Focus - Test", "If you see this, notifications are working! 🎉");
  }

  /**
   * Show the check-in selector modal.
   */
  async showCheckinSelector() {
    const modal = new CheckinSelectorModal(this.app);
    const result = await modal.prompt();

    if (!result) return;

    switch (result) {
      case "morning":
        await this.generateDailyFocus();
        break;
      case "midday":
        await this.runCheckin();
        break;
      case "eod":
        await this.runEODCheckin();
        break;
    }
  }

  /**
   * Main entry point for generating the daily focus agenda.
   * Implements the complete application flow (Steps 1-6).
   */
  async generateDailyFocus() {
    if (!this.contextGatherer || !this.llmService) {
      new Notice("Plugin not properly initialized.");
      return;
    }

    // Validate configuration based on provider
    if (this.settings.llmProvider === "api" && !this.settings.anthropicApiKey) {
      new Notice(
        "Please configure your Anthropic API key in the plugin settings, or switch to CLI mode."
      );
      return;
    }

    try {
      // Step 1: Ask what the user is working on today
      const focusModal = new FocusPromptModal(this.app);
      const userFocusInput = await focusModal.prompt();

      // Step 2: Gather context with progress updates
      const statusNotice = new Notice("📂 Reading vault files...", 0); // 0 = don't auto-hide

      // Gather Enhanced Context (includes GitHub/Jira if enabled)
      let context: EnhancedContext;
      try {
        // Update status for each phase
        const updateStatus = (msg: string) => {
          statusNotice.setMessage(msg);
        };

        updateStatus("📂 Reading vault files...");
        const basicContext = await this.contextGatherer.gatherContext(
          this.settings.dailyFolder,
          this.settings.meetingsFolder,
          this.settings.lookbackDays
        );

        // Initialize enhanced context
        context = {
          ...basicContext,
          pullRequests: [],
          jiraTickets: [],
          reconciliation: {
            matchedPRs: [],
            matchedTickets: [],
            unmatchedPRs: [],
            unmatchedTickets: [],
            warnings: [],
          },
          userFocusInput,
        };

        // Fetch GitHub and Jira in parallel with status updates
        const fetchPromises: Promise<void>[] = [];

        if (this.settings.enableGitHub) {
          updateStatus("🐙 Fetching GitHub PRs...");
          fetchPromises.push(
            this.contextGatherer
              .gatherEnhancedContext(
                this.settings.dailyFolder,
                this.settings.meetingsFolder,
                this.settings.lookbackDays
              )
              .then((enhanced) => {
                context.pullRequests = enhanced.pullRequests;
                context.jiraTickets = enhanced.jiraTickets;
                context.reconciliation = enhanced.reconciliation;
              })
              .catch((error) => {
                console.error("[DailyFocus] Integration fetch failed:", error);
              })
          );
        }

        if (fetchPromises.length > 0) {
          if (this.settings.enableGitHub && this.settings.enableJira) {
            updateStatus("🔄 Fetching GitHub & Jira...");
          } else if (this.settings.enableGitHub) {
            updateStatus("🐙 Fetching GitHub PRs...");
          } else if (this.settings.enableJira) {
            updateStatus("🎫 Fetching Jira tickets...");
          }
          await Promise.all(fetchPromises);
        }
      } catch (error) {
        console.error("[DailyFocus] Failed to gather context:", error);
        statusNotice.hide();
        new Notice("Failed to gather context. Creating basic agenda.", 5000);

        const basicContext = await this.contextGatherer.gatherContext(
          this.settings.dailyFolder,
          this.settings.meetingsFolder,
          this.settings.lookbackDays
        );
        context = {
          ...basicContext,
          pullRequests: [],
          jiraTickets: [],
          reconciliation: {
            matchedPRs: [],
            matchedTickets: [],
            unmatchedPRs: [],
            unmatchedTickets: [],
            warnings: [],
          },
          userFocusInput,
        };
      }

      // Step 3: Prompt for Meeting Note Updates (if needed)
      statusNotice.hide();
      if (context.meetingsNeedingAttention.length > 0) {
        const meetingModal = new MeetingPromptModal(this.app, context.meetingsNeedingAttention);
        const meetingResult = await meetingModal.prompt();

        if (meetingResult === "continue") {
          // Re-gather context in case user updated meeting notes
          const updatedContext = await this.contextGatherer.gatherEnhancedContext(
            this.settings.dailyFolder,
            this.settings.meetingsFolder,
            this.settings.lookbackDays
          );
          Object.assign(context, updatedContext);
        }
        // If "skip", continue with existing context
      }

      // Step 4: LLM Triage Scan with status
      const providerName = this.settings.llmProvider === "cli" ? "Claude CLI" : "API";
      const llmNotice = new Notice(`🤖 Analyzing with ${providerName}...`, 0);

      let triageResponse;
      try {
        triageResponse = await this.llmService.triageScanWithRetry(context);
        llmNotice.hide();
      } catch (error) {
        llmNotice.hide();
        new Notice(`LLM error: ${error}. Creating empty agenda.`, 10000);
        // Create empty agenda if LLM fails (simplified 3-section format)
        triageResponse = {
          draftAgenda: {
            focusToday: [],
            quickWins: [],
            later: [],
          },
          unclearItems: [],
          suggestions: [],
        };
      }

      // Step 5: Status Update Prompts (if there are unclear items)
      let finalDraft = triageResponse.draftAgenda;
      let allSuggestions = triageResponse.suggestions;

      if (triageResponse.unclearItems.length > 0) {
        const statusModal = new StatusUpdateModal(this.app, triageResponse.unclearItems);
        const resolvedItems = await statusModal.prompt();

        // Step 5b: Have LLM refine the agenda based on user clarifications
        if (resolvedItems.length > 0) {
          const refineNotice = new Notice("🤖 Refining agenda with your input...", 0);
          try {
            const refined = await this.llmService.refineAgenda(
              triageResponse.draftAgenda,
              triageResponse.unclearItems,
              resolvedItems
            );
            finalDraft = refined.draftAgenda;
            allSuggestions = [...triageResponse.suggestions, ...refined.suggestions];
            refineNotice.hide();
          } catch (error) {
            console.error("[DailyFocus] Refinement failed, using simple merge:", error);
            refineNotice.hide();
            // Fallback to simple merge if LLM fails
            finalDraft = mergeDraftWithResolutions(triageResponse.draftAgenda, resolvedItems);
          }
        }
      }

      // Step 6: Draft Review and Save
      const reviewModal = new DraftReviewModal(
        this.app,
        finalDraft,
        allSuggestions,
        this.settings.dailyFolder
      );
      const reviewResult = await reviewModal.prompt();

      if (reviewResult.action === "cancel") {
        new Notice("Daily Focus generation cancelled.");
        return;
      }

      // Append status tables if we have GitHub/Jira data
      let finalContent = reviewResult.content;
      if (context.pullRequests.length > 0 || context.jiraTickets.length > 0) {
        finalContent += renderStatusTables(
          context.pullRequests,
          context.jiraTickets,
          context.reconciliation
        );
      }

      // Save the file
      const filePath = `${this.settings.dailyFolder}/${getTodayDate()}.md`;
      await this.saveAgendaFile(filePath, finalContent);

      // Mark morning check-in complete (stops reminders)
      this.markCheckinComplete("morning");

      new Notice("Daily Focus saved successfully! ✨");

      // Open the file
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        const leaf = this.app.workspace.getLeaf();
        await leaf.openFile(file);
      }
    } catch (error) {
      console.error("Daily Focus error:", error);
      new Notice(`Error generating Daily Focus: ${error}`);
    }
  }

  /**
   * Run the mid-day check-in flow.
   * Reads today's agenda, prompts for updates, and saves changes.
   */
  async runCheckin() {
    const filePath = `${this.settings.dailyFolder}/${getTodayDate()}.md`;
    const file = this.app.vault.getAbstractFileByPath(filePath);

    if (!(file instanceof TFile)) {
      new Notice("No agenda for today yet. Create one first with 'Generate Daily Focus'.");
      return;
    }

    try {
      // Read current agenda
      const content = await this.app.vault.read(file);
      const currentAgenda = parseMarkdownToAgenda(content);

      if (!currentAgenda) {
        new Notice("Could not parse today's agenda. The file format may be different.");
        return;
      }

      // Show check-in modal
      const checkinModal = new CheckinModal(this.app, currentAgenda);
      const result = await checkinModal.prompt();

      if (result.cancelled) {
        return;
      }

      // Process results and update the file
      let updatedContent = content;

      // Mark completed tasks
      for (const completedTask of result.completedTasks) {
        // Replace - [ ] with - [x] for this task
        const escapedTask = completedTask.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const taskRegex = new RegExp(`- \\[ \\] ${escapedTask}`, "g");
        updatedContent = updatedContent.replace(taskRegex, `- [x] ${completedTask}`);
      }

      // Add check-in notes section if there's new work or blockers
      if (result.newWork || result.blockers) {
        const checkinTime = new Date().toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });

        let checkinSection = `\n\n## Check-in (${checkinTime})\n`;

        if (result.newWork) {
          checkinSection += `\n### New work\n${result.newWork}\n`;
        }

        if (result.blockers) {
          checkinSection += `\n### Blockers\n${result.blockers}\n`;
        }

        // Add before any status tables (GitHub/Jira) or at the end
        const statusTableIndex = updatedContent.indexOf("\n## GitHub PRs");
        if (statusTableIndex !== -1) {
          updatedContent =
            updatedContent.slice(0, statusTableIndex) +
            checkinSection +
            updatedContent.slice(statusTableIndex);
        } else {
          updatedContent += checkinSection;
        }
      }

      // Save updated content
      await this.app.vault.modify(file, updatedContent);

      // Mark midday check-in complete (stops reminders)
      this.markCheckinComplete("midday");

      const completedCount = result.completedTasks.length;
      if (completedCount > 0) {
        new Notice(
          `Check-in saved! ${completedCount} task${completedCount > 1 ? "s" : ""} marked complete. 🎉`
        );
      } else {
        new Notice("Check-in saved!");
      }

      // Open the file
      const leaf = this.app.workspace.getLeaf();
      await leaf.openFile(file);
    } catch (error) {
      console.error("Check-in error:", error);
      new Notice(`Error during check-in: ${error}`);
    }
  }

  /**
   * Run the end-of-day wrap-up flow.
   * Prompts for reflection and saves to today's agenda.
   */
  async runEODCheckin() {
    const filePath = `${this.settings.dailyFolder}/${getTodayDate()}.md`;
    const file = this.app.vault.getAbstractFileByPath(filePath);

    if (!(file instanceof TFile)) {
      new Notice("No agenda for today. Nothing to wrap up!");
      return;
    }

    try {
      // Read current agenda
      const content = await this.app.vault.read(file);
      const currentAgenda = parseMarkdownToAgenda(content);

      if (!currentAgenda) {
        new Notice("Could not parse today's agenda.");
        return;
      }

      // Show EOD check-in modal
      const eodModal = new EODCheckinModal(this.app, currentAgenda);
      const result = await eodModal.prompt();

      if (result.cancelled) {
        return;
      }

      // Process results and update the file
      let updatedContent = content;

      // Mark completed tasks
      for (const completedTask of result.completedTasks) {
        const escapedTask = completedTask.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const taskRegex = new RegExp(`- \\[ \\] ${escapedTask}`, "g");
        updatedContent = updatedContent.replace(taskRegex, `- [x] ${completedTask}`);
      }

      // Add end-of-day reflection section
      if (result.wentWell || result.didntGetDone || result.forTomorrow) {
        let eodSection = `\n\n## End of Day Reflection\n`;

        if (result.wentWell) {
          eodSection += `\n### What went well\n${result.wentWell}\n`;
        }

        if (result.didntGetDone) {
          eodSection += `\n### What didn't happen\n${result.didntGetDone}\n`;
        }

        if (result.forTomorrow) {
          eodSection += `\n### For tomorrow\n${result.forTomorrow}\n`;
        }

        // Add before any status tables or at the end
        const statusTableIndex = updatedContent.indexOf("\n## GitHub PRs");
        if (statusTableIndex !== -1) {
          updatedContent =
            updatedContent.slice(0, statusTableIndex) +
            eodSection +
            updatedContent.slice(statusTableIndex);
        } else {
          updatedContent += eodSection;
        }
      }

      // Save updated content
      await this.app.vault.modify(file, updatedContent);

      // Mark EOD check-in complete (stops reminders)
      this.markCheckinComplete("eod");

      const completedCount = result.completedTasks.length;
      if (completedCount > 0) {
        new Notice(
          `Day wrapped up! ${completedCount} more task${completedCount > 1 ? "s" : ""} complete. 🌅`
        );
      } else {
        new Notice("Day wrapped up! Have a great evening. 🌅");
      }

      // Open the file
      const leaf = this.app.workspace.getLeaf();
      await leaf.openFile(file);
    } catch (error) {
      console.error("EOD check-in error:", error);
      new Notice(`Error during wrap-up: ${error}`);
    }
  }

  /**
   * Save the agenda content to a file.
   */
  private async saveAgendaFile(path: string, content: string): Promise<void> {
    const vaultReader = this.contextGatherer?.getVaultReader();
    if (!vaultReader) {
      throw new Error("VaultReader not initialized");
    }

    // Ensure the daily folder exists
    await vaultReader.ensureFolder(this.settings.dailyFolder);

    // Write the file
    await vaultReader.writeFile(path, content);
  }
}
