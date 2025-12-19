import { App, Modal, TFile } from "obsidian";
import { MeetingNeedingAttention } from "../types";

export type MeetingPromptResult = "continue" | "skip";

/**
 * Modal that prompts the user to update meeting notes before generating agenda.
 * Implements Step 3 of the application flow.
 */
export class MeetingPromptModal extends Modal {
  private meetings: MeetingNeedingAttention[];
  private resolvePromise: ((result: MeetingPromptResult) => void) | null = null;

  constructor(app: App, meetings: MeetingNeedingAttention[]) {
    super(app);
    this.meetings = meetings;
  }

  /**
   * Show the modal and wait for user interaction.
   * Returns "continue" or "skip" based on user choice.
   */
  async prompt(): Promise<MeetingPromptResult> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("daily-focus-modal");

    // Header
    contentEl.createEl("h2", { text: "Meeting Notes Need Attention" });

    // Description
    contentEl.createEl("p", {
      text: "Before we start, these meeting notes may need updates:",
    });

    // List of meetings
    const list = contentEl.createEl("ul", { cls: "daily-focus-meeting-list" });
    for (const meeting of this.meetings) {
      const li = list.createEl("li");

      // Make the filename clickable to open the file
      const link = li.createEl("a", {
        text: meeting.filepath,
        cls: "daily-focus-meeting-link",
        href: "#",
      });
      link.addEventListener("click", async (e) => {
        e.preventDefault();
        await this.openFile(meeting.filepath);
      });

      // Add reason in parentheses
      li.createSpan({ text: ` (${meeting.reason})`, cls: "daily-focus-meeting-reason" });
    }

    // Instructions
    contentEl.createEl("p", {
      text: "Please update these notes in Obsidian if there are action items to capture, then click Continue.",
      cls: "daily-focus-instructions",
    });

    // Button container
    const buttonContainer = contentEl.createDiv({ cls: "daily-focus-button-container" });

    // Skip button
    const skipButton = buttonContainer.createEl("button", {
      text: "Skip",
      cls: "daily-focus-button-secondary",
    });
    skipButton.addEventListener("click", () => {
      this.close();
      this.resolvePromise?.("skip");
    });

    // Continue button
    const continueButton = buttonContainer.createEl("button", {
      text: "Continue",
      cls: "daily-focus-button-primary",
    });
    continueButton.addEventListener("click", () => {
      this.close();
      this.resolvePromise?.("continue");
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  /**
   * Open a file in Obsidian.
   */
  private async openFile(filepath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filepath);
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.openFile(file);
    }
  }
}
