import { App, Modal } from "obsidian";
import { DraftAgenda } from "../types";

export interface EODCheckinResult {
  /** Tasks marked as completed */
  completedTasks: string[];
  /** Reflection on what went well */
  wentWell: string;
  /** What didn't get done and why */
  didntGetDone: string;
  /** Notes for tomorrow */
  forTomorrow: string;
  /** Whether the user cancelled */
  cancelled: boolean;
}

/**
 * Modal for end-of-day wrap-up.
 * Focused on reflection and planning for tomorrow.
 */
export class EODCheckinModal extends Modal {
  private currentAgenda: DraftAgenda;
  private resolvePromise: ((result: EODCheckinResult) => void) | null = null;

  // Form state
  private completedTasks: Set<string> = new Set();
  private wentWellInput: string = "";
  private didntGetDoneInput: string = "";
  private forTomorrowInput: string = "";

  constructor(app: App, currentAgenda: DraftAgenda) {
    super(app);
    this.currentAgenda = currentAgenda;
  }

  async prompt(): Promise<EODCheckinResult> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass("daily-focus-modal");
    contentEl.addClass("daily-focus-checkin-modal");
    modalEl.addClass("daily-focus-checkin-container");

    // Header
    contentEl.createEl("h2", { text: "🌅 End of Day Wrap-up" });
    contentEl.createEl("p", {
      text: "Let's reflect on today and set up for tomorrow.",
      cls: "daily-focus-checkin-subtitle",
    });

    // Section 1: Final task check
    const doneSection = contentEl.createDiv({ cls: "daily-focus-checkin-section" });
    doneSection.createEl("h3", { text: "✅ Final check: What got done?" });

    const allTasks = [
      ...this.currentAgenda.focusToday.map((t) => ({ task: t, section: "Focus" })),
      ...this.currentAgenda.quickWins.map((t) => ({ task: t, section: "Quick wins" })),
    ];

    if (allTasks.length > 0) {
      const taskList = doneSection.createDiv({ cls: "daily-focus-checkin-tasks" });
      for (const { task, section } of allTasks) {
        const taskItem = taskList.createDiv({ cls: "daily-focus-checkin-task" });

        const checkbox = taskItem.createEl("input", {
          type: "checkbox",
          attr: { id: `eod-task-${task.substring(0, 20)}` },
        });
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            this.completedTasks.add(task);
          } else {
            this.completedTasks.delete(task);
          }
        });

        const label = taskItem.createEl("label", {
          attr: { for: `eod-task-${task.substring(0, 20)}` },
        });
        label.createEl("span", { text: task, cls: "daily-focus-checkin-task-text" });
        label.createEl("span", { text: section, cls: "daily-focus-checkin-task-section" });
      }
    } else {
      doneSection.createEl("p", {
        text: "No tasks in today's agenda.",
        cls: "daily-focus-empty-state",
      });
    }

    // Section 2: What went well
    const wellSection = contentEl.createDiv({ cls: "daily-focus-checkin-section" });
    wellSection.createEl("h3", { text: "🎉 What went well today?" });

    const wentWellTextarea = wellSection.createEl("textarea", {
      cls: "daily-focus-checkin-textarea",
      attr: {
        rows: "2",
        placeholder: "Wins, progress made, things that clicked...",
      },
    });
    wentWellTextarea.addEventListener("input", (e) => {
      this.wentWellInput = (e.target as HTMLTextAreaElement).value;
    });

    // Section 3: What didn't get done
    const missedSection = contentEl.createDiv({ cls: "daily-focus-checkin-section" });
    missedSection.createEl("h3", { text: "🤔 What didn't happen?" });
    missedSection.createEl("p", {
      text: "No judgment—just note what got pushed and why:",
      cls: "daily-focus-section-hint",
    });

    const didntGetDoneTextarea = missedSection.createEl("textarea", {
      cls: "daily-focus-checkin-textarea",
      attr: {
        rows: "2",
        placeholder: "e.g., PR review got pushed—waiting on feedback, roadmap work blocked...",
      },
    });
    didntGetDoneTextarea.addEventListener("input", (e) => {
      this.didntGetDoneInput = (e.target as HTMLTextAreaElement).value;
    });

    // Section 4: For tomorrow
    const tomorrowSection = contentEl.createDiv({ cls: "daily-focus-checkin-section" });
    tomorrowSection.createEl("h3", { text: "📋 Top of mind for tomorrow" });

    const forTomorrowTextarea = tomorrowSection.createEl("textarea", {
      cls: "daily-focus-checkin-textarea",
      attr: {
        rows: "2",
        placeholder: "What should you tackle first thing tomorrow?",
      },
    });
    forTomorrowTextarea.addEventListener("input", (e) => {
      this.forTomorrowInput = (e.target as HTMLTextAreaElement).value;
    });

    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: "daily-focus-button-container" });

    const skipButton = buttonContainer.createEl("button", {
      text: "Skip",
      cls: "daily-focus-button-secondary",
    });
    skipButton.addEventListener("click", () => {
      this.close();
      this.resolvePromise?.({
        completedTasks: [],
        wentWell: "",
        didntGetDone: "",
        forTomorrow: "",
        cancelled: true,
      });
    });

    const submitButton = buttonContainer.createEl("button", {
      text: "Save & Wrap Up",
      cls: "daily-focus-button-primary",
    });
    submitButton.addEventListener("click", () => {
      this.close();
      this.resolvePromise?.({
        completedTasks: Array.from(this.completedTasks),
        wentWell: this.wentWellInput,
        didntGetDone: this.didntGetDoneInput,
        forTomorrow: this.forTomorrowInput,
        cancelled: false,
      });
    });

    // Handle Cmd/Ctrl+Enter to submit
    contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submitButton.click();
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
