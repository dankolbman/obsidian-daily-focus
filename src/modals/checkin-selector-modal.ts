import { App, Modal } from "obsidian";

export type CheckinType = "morning" | "midday" | "eod";

export class CheckinSelectorModal extends Modal {
  private resolvePromise: ((result: CheckinType | null) => void) | null = null;

  constructor(app: App) {
    super(app);
  }

  async prompt(): Promise<CheckinType | null> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("daily-focus-modal");
    contentEl.addClass("daily-focus-checkin-selector-modal");

    contentEl.createEl("h2", { text: "Select Check-in Type" });
    contentEl.createEl("p", {
      text: "Which part of your day are you checking in on?",
      cls: "daily-focus-prompt-hint",
    });

    const optionsContainer = contentEl.createDiv({ cls: "daily-focus-selector-options" });

    this.createOption(
      optionsContainer,
      "☀️ Start of Day",
      "Plan your day and set focus",
      "morning"
    );

    this.createOption(
      optionsContainer,
      "🌤️ Mid-day Check-in",
      "Update progress and report blockers",
      "midday"
    );

    this.createOption(
      optionsContainer,
      "🌅 End of Day Wrap-up",
      "Reflect on your day and plan for tomorrow",
      "eod"
    );

    // Button container for cancel
    const buttonContainer = contentEl.createDiv({
      cls: "daily-focus-button-container",
    });

    const cancelButton = buttonContainer.createEl("button", {
      text: "Cancel",
      cls: "daily-focus-button-secondary",
    });
    cancelButton.addEventListener("click", () => {
      this.close();
      this.resolvePromise?.(null);
    });
  }

  private createOption(
    container: HTMLElement,
    title: string,
    description: string,
    type: CheckinType
  ) {
    const optionEl = container.createDiv({ cls: "daily-focus-selector-option" });

    const infoEl = optionEl.createDiv({ cls: "daily-focus-selector-option-info" });
    infoEl.createEl("div", { text: title, cls: "daily-focus-selector-option-title" });
    infoEl.createEl("div", { text: description, cls: "daily-focus-selector-option-description" });

    optionEl.addEventListener("click", () => {
      this.close();
      this.resolvePromise?.(type);
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
