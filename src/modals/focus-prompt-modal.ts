import { App, Modal } from "obsidian";

/**
 * Modal to prompt the user about what they're working on today.
 * This helps discover new tasks not captured in the vault or external systems.
 */
export class FocusPromptModal extends Modal {
  private resolvePromise: ((result: string) => void) | null = null;
  private textareaEl: HTMLTextAreaElement | null = null;

  constructor(app: App) {
    super(app);
  }

  /**
   * Show the modal and wait for user input.
   * Returns the user's response (empty string if skipped).
   */
  async prompt(): Promise<string> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass("daily-focus-modal");
    contentEl.addClass("daily-focus-focus-prompt-modal");
    modalEl.addClass("daily-focus-focus-prompt-container");

    // Header
    contentEl.createEl("h2", { text: "What's on your mind today?" });

    contentEl.createEl("p", {
      text: "Briefly describe what you're working on, any new tasks, or things you want to focus on. This helps generate a more relevant agenda.",
      cls: "daily-focus-prompt-hint",
    });

    // Textarea for input
    this.textareaEl = contentEl.createEl("textarea", {
      cls: "daily-focus-focus-input",
      attr: {
        rows: "4",
        placeholder:
          "e.g., Need to finish the API review, have a meeting about deployment, should follow up with Alice about the design...",
      },
    });

    // Button container
    const buttonContainer = contentEl.createDiv({
      cls: "daily-focus-button-container",
    });

    // Skip button
    const skipButton = buttonContainer.createEl("button", {
      text: "Skip",
      cls: "daily-focus-button-secondary",
    });
    skipButton.addEventListener("click", () => {
      this.close();
      this.resolvePromise?.("");
    });

    // Continue button
    const continueButton = buttonContainer.createEl("button", {
      text: "Continue",
      cls: "daily-focus-button-primary",
    });
    continueButton.addEventListener("click", () => {
      const input = this.textareaEl?.value || "";
      this.close();
      this.resolvePromise?.(input);
    });

    // Handle Enter key (Cmd/Ctrl+Enter to submit)
    this.textareaEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const input = this.textareaEl?.value || "";
        this.close();
        this.resolvePromise?.(input);
      }
    });

    // Focus the textarea
    setTimeout(() => {
      this.textareaEl?.focus();
    }, 50);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
