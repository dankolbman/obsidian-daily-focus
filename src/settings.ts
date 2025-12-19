import { App, PluginSettingTab, Setting } from "obsidian";
import type DailyFocusPlugin from "./main";
import type { LLMProvider } from "./services/llm-service";

export interface DailyFocusSettings {
  dailyFolder: string;
  meetingsFolder: string;
  notificationTime: string;
  checkinTime: string;
  endOfDayTime: string;
  reminderInterval: number; // minutes between follow-up reminders
  lookbackDays: number;
  // LLM settings
  llmProvider: LLMProvider;
  anthropicApiKey: string;
  model: string;
  cliPath: string;
  // GitHub integration
  enableGitHub: boolean;
  githubRepo: string;
  ghCliPath: string;
  // Jira integration
  enableJira: boolean;
  jiraProjectKey: string;
  jiraBaseUrl: string;
  jiraCliPath: string;
}

export const DEFAULT_SETTINGS: DailyFocusSettings = {
  dailyFolder: "daily",
  meetingsFolder: "meetings",
  notificationTime: "08:30",
  checkinTime: "13:00",
  endOfDayTime: "16:00",
  reminderInterval: 10,
  lookbackDays: 7,
  // LLM defaults
  llmProvider: "cli",
  anthropicApiKey: "",
  model: "claude-sonnet-4-20250514",
  cliPath: "claude",
  // GitHub defaults
  enableGitHub: false,
  githubRepo: "",
  ghCliPath: "gh",
  // Jira defaults
  enableJira: false,
  jiraProjectKey: "",
  jiraBaseUrl: "",
  jiraCliPath: "jira",
};

export class DailyFocusSettingTab extends PluginSettingTab {
  plugin: DailyFocusPlugin;

  constructor(app: App, plugin: DailyFocusPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Daily Focus Settings" });

    // Vault Folders Section
    containerEl.createEl("h3", { text: "Vault Folders" });

    new Setting(containerEl)
      .setName("Daily folder")
      .setDesc("Folder containing daily agenda files (relative to vault root)")
      .addText((text) =>
        text
          .setPlaceholder("daily")
          .setValue(this.plugin.settings.dailyFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Meetings folder")
      .setDesc("Folder containing meeting notes (relative to vault root)")
      .addText((text) =>
        text
          .setPlaceholder("meetings")
          .setValue(this.plugin.settings.meetingsFolder)
          .onChange(async (value) => {
            this.plugin.settings.meetingsFolder = value;
            await this.plugin.saveSettings();
          })
      );

    // Scheduling Section
    containerEl.createEl("h3", { text: "Scheduling" });

    new Setting(containerEl)
      .setName("Morning notification time")
      .setDesc("Time to remind you to plan your day (HH:MM format, leave empty to disable)")
      .addText((text) =>
        text
          .setPlaceholder("08:30")
          .setValue(this.plugin.settings.notificationTime)
          .onChange(async (value) => {
            this.plugin.settings.notificationTime = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Mid-day check-in time")
      .setDesc("Time for a mid-day progress check (HH:MM format, leave empty to disable)")
      .addText((text) =>
        text
          .setPlaceholder("13:00")
          .setValue(this.plugin.settings.checkinTime)
          .onChange(async (value) => {
            this.plugin.settings.checkinTime = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("End-of-day wrap-up time")
      .setDesc("Time for end-of-day reflection (HH:MM format, leave empty to disable)")
      .addText((text) =>
        text
          .setPlaceholder("16:00")
          .setValue(this.plugin.settings.endOfDayTime)
          .onChange(async (value) => {
            this.plugin.settings.endOfDayTime = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Reminder interval")
      .setDesc("Minutes between follow-up reminders if you don't respond")
      .addSlider((slider) =>
        slider
          .setLimits(5, 30, 5)
          .setValue(this.plugin.settings.reminderInterval)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.reminderInterval = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Test notification")
      .setDesc("Send a test notification to verify OS notifications are working")
      .addButton((button) =>
        button.setButtonText("Send Test").onClick(() => {
          this.plugin.testNotification();
        })
      );

    new Setting(containerEl)
      .setName("Lookback days")
      .setDesc("Number of days of history to include when analyzing")
      .addSlider((slider) =>
        slider
          .setLimits(1, 14, 1)
          .setValue(this.plugin.settings.lookbackDays)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.lookbackDays = value;
            await this.plugin.saveSettings();
          })
      );

    // LLM Section
    containerEl.createEl("h3", { text: "LLM Configuration" });

    new Setting(containerEl)
      .setName("LLM Provider")
      .setDesc("How to connect to Claude")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("cli", "Claude CLI (recommended)")
          .addOption("api", "Anthropic API")
          .setValue(this.plugin.settings.llmProvider)
          .onChange(async (value: LLMProvider) => {
            this.plugin.settings.llmProvider = value;
            await this.plugin.saveSettings();
            // Re-render to show/hide relevant settings
            this.display();
          })
      );

    if (this.plugin.settings.llmProvider === "cli") {
      // CLI-specific settings
      new Setting(containerEl)
        .setName("Claude CLI path")
        .setDesc("Path to the claude CLI executable (usually just 'claude' if it's in your PATH)")
        .addText((text) =>
          text
            .setPlaceholder("claude")
            .setValue(this.plugin.settings.cliPath)
            .onChange(async (value) => {
              this.plugin.settings.cliPath = value;
              await this.plugin.saveSettings();
            })
        );

      // Help text for CLI setup
      const cliHelp = containerEl.createDiv({ cls: "setting-item-description" });
      cliHelp.style.marginTop = "0.5rem";
      cliHelp.style.padding = "0.75rem";
      cliHelp.style.backgroundColor = "var(--background-secondary)";
      cliHelp.style.borderRadius = "4px";
      cliHelp.innerHTML = `
        <strong>CLI Setup:</strong><br>
        1. Install the Claude CLI: <code>npm install -g @anthropic-ai/claude-code</code><br>
        2. Authenticate: <code>claude auth login</code><br>
        3. The CLI will use your authenticated session automatically.
      `;
    } else {
      // API-specific settings
      new Setting(containerEl)
        .setName("Anthropic API Key")
        .setDesc("Your Anthropic API key for Claude")
        .addText((text) =>
          text
            .setPlaceholder("sk-ant-...")
            .setValue(this.plugin.settings.anthropicApiKey)
            .onChange(async (value) => {
              this.plugin.settings.anthropicApiKey = value;
              await this.plugin.saveSettings();
            })
        )
        .then((setting) => {
          // Make it a password field
          const inputEl = setting.controlEl.querySelector("input");
          if (inputEl) {
            inputEl.type = "password";
          }
        });

      new Setting(containerEl)
        .setName("Model")
        .setDesc("Claude model to use")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("claude-sonnet-4-20250514", "Claude Sonnet 4")
            .addOption("claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet")
            .addOption("claude-3-5-haiku-20241022", "Claude 3.5 Haiku")
            .setValue(this.plugin.settings.model)
            .onChange(async (value) => {
              this.plugin.settings.model = value;
              await this.plugin.saveSettings();
            })
        );
    }

    // GitHub Integration Section
    containerEl.createEl("h3", { text: "GitHub Integration" });

    new Setting(containerEl)
      .setName("Enable GitHub")
      .setDesc("Fetch open PRs and include them in the daily focus")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableGitHub).onChange(async (value) => {
          this.plugin.settings.enableGitHub = value;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (this.plugin.settings.enableGitHub) {
      new Setting(containerEl)
        .setName("GitHub repository")
        .setDesc("Repository to fetch PRs from (org/repo format)")
        .addText((text) =>
          text
            .setPlaceholder("ZiplineTeam/FlightSystems")
            .setValue(this.plugin.settings.githubRepo)
            .onChange(async (value) => {
              this.plugin.settings.githubRepo = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("gh CLI path")
        .setDesc("Path to the GitHub CLI executable")
        .addText((text) =>
          text
            .setPlaceholder("gh")
            .setValue(this.plugin.settings.ghCliPath)
            .onChange(async (value) => {
              this.plugin.settings.ghCliPath = value;
              await this.plugin.saveSettings();
            })
        );

      const ghHelp = containerEl.createDiv({ cls: "setting-item-description" });
      ghHelp.style.marginTop = "0.5rem";
      ghHelp.style.padding = "0.75rem";
      ghHelp.style.backgroundColor = "var(--background-secondary)";
      ghHelp.style.borderRadius = "4px";
      ghHelp.innerHTML = `
        <strong>GitHub CLI Setup:</strong><br>
        1. Install: <code>brew install gh</code><br>
        2. Authenticate: <code>gh auth login</code>
      `;
    }

    // Jira Integration Section
    containerEl.createEl("h3", { text: "Jira Integration" });

    new Setting(containerEl)
      .setName("Enable Jira")
      .setDesc("Fetch in-progress tickets and include them in the daily focus")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableJira).onChange(async (value) => {
          this.plugin.settings.enableJira = value;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (this.plugin.settings.enableJira) {
      new Setting(containerEl)
        .setName("Jira project key")
        .setDesc("Project key to filter tickets (e.g., FSW)")
        .addText((text) =>
          text
            .setPlaceholder("FSW")
            .setValue(this.plugin.settings.jiraProjectKey)
            .onChange(async (value) => {
              this.plugin.settings.jiraProjectKey = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Jira base URL")
        .setDesc("Your Jira instance URL")
        .addText((text) =>
          text
            .setPlaceholder("https://yourcompany.atlassian.net")
            .setValue(this.plugin.settings.jiraBaseUrl)
            .onChange(async (value) => {
              this.plugin.settings.jiraBaseUrl = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("jira CLI path")
        .setDesc("Path to the Jira CLI executable")
        .addText((text) =>
          text
            .setPlaceholder("jira")
            .setValue(this.plugin.settings.jiraCliPath)
            .onChange(async (value) => {
              this.plugin.settings.jiraCliPath = value;
              await this.plugin.saveSettings();
            })
        );

      const jiraHelp = containerEl.createDiv({ cls: "setting-item-description" });
      jiraHelp.style.marginTop = "0.5rem";
      jiraHelp.style.padding = "0.75rem";
      jiraHelp.style.backgroundColor = "var(--background-secondary)";
      jiraHelp.style.borderRadius = "4px";
      jiraHelp.innerHTML = `
        <strong>Jira CLI Setup:</strong><br>
        1. Install go-jira: <code>brew install go-jira</code><br>
        2. Configure: <code>jira config</code> and follow prompts
      `;
    }
  }
}
