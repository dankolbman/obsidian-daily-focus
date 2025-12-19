import { App, Modal, TFile } from "obsidian";
import { DraftAgenda } from "../types";
import { renderAgendaToMarkdown } from "../utils/markdown-utils";
import { getTodayDate } from "../utils/date-utils";

export type DraftReviewResult = { action: "save"; content: string } | { action: "cancel" };

/**
 * Modal for reviewing and editing the draft agenda before saving.
 * Implements Step 6 of the application flow.
 */
export class DraftReviewModal extends Modal {
  private draft: DraftAgenda;
  private suggestions: string[];
  private dailyFolder: string;
  private resolvePromise: ((result: DraftReviewResult) => void) | null = null;
  private textareaEl: HTMLTextAreaElement | null = null;

  constructor(app: App, draft: DraftAgenda, suggestions: string[], dailyFolder: string) {
    super(app);
    this.draft = draft;
    this.suggestions = suggestions;
    this.dailyFolder = dailyFolder;
  }

  /**
   * Show the modal and wait for user action.
   */
  async prompt(): Promise<DraftReviewResult> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass("daily-focus-modal");
    contentEl.addClass("daily-focus-draft-modal");

    // Make modal larger
    modalEl.addClass("daily-focus-draft-modal-container");

    // Header
    const header = contentEl.createDiv({ cls: "daily-focus-draft-header" });
    header.createEl("h2", { text: `Daily Focus — ${getTodayDate()}` });

    // Suggestions (if any)
    if (this.suggestions.length > 0) {
      const suggestionsContainer = contentEl.createDiv({
        cls: "daily-focus-suggestions",
      });
      suggestionsContainer.createEl("h4", { text: "💡 Suggestions" });
      const suggestionsList = suggestionsContainer.createEl("ul");
      for (const suggestion of this.suggestions) {
        suggestionsList.createEl("li", { text: suggestion });
      }
    }

    // Editor section
    const editorContainer = contentEl.createDiv({ cls: "daily-focus-editor-container" });
    editorContainer.createEl("h4", { text: "Edit your agenda" });
    editorContainer.createEl("p", {
      text: "Make any changes below, then click Save to create your daily agenda.",
      cls: "daily-focus-editor-hint",
    });

    // Textarea for editing
    const initialContent = renderAgendaToMarkdown(this.draft);
    this.textareaEl = editorContainer.createEl("textarea", {
      cls: "daily-focus-editor",
      attr: {
        rows: "20",
        spellcheck: "true",
      },
    });
    this.textareaEl.value = initialContent;

    // File path preview
    const filePath = `${this.dailyFolder}/${getTodayDate()}.md`;
    const pathPreview = contentEl.createDiv({ cls: "daily-focus-path-preview" });
    pathPreview.createEl("span", { text: "Will save to: " });
    pathPreview.createEl("code", { text: filePath });

    // Check if file already exists
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);
    if (existingFile instanceof TFile) {
      const warning = contentEl.createDiv({ cls: "daily-focus-warning" });
      warning.createEl("span", { text: "⚠️ This file already exists and will be overwritten." });
    }

    // Button container
    const buttonContainer = contentEl.createDiv({
      cls: "daily-focus-button-container",
    });

    // Cancel button
    const cancelButton = buttonContainer.createEl("button", {
      text: "Cancel",
      cls: "daily-focus-button-secondary",
    });
    cancelButton.addEventListener("click", () => {
      this.close();
      this.resolvePromise?.({ action: "cancel" });
    });

    // Save button
    const saveButton = buttonContainer.createEl("button", {
      text: "Save",
      cls: "daily-focus-button-primary",
    });
    saveButton.addEventListener("click", () => {
      const content = this.textareaEl?.value || "";
      this.close();
      this.resolvePromise?.({ action: "save", content });
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

/**
 * Modal for confirming overwrite of existing file.
 */
export class ConfirmOverwriteModal extends Modal {
  private filePath: string;
  private resolvePromise: ((confirmed: boolean) => void) | null = null;

  constructor(app: App, filePath: string) {
    super(app);
    this.filePath = filePath;
  }

  async prompt(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("daily-focus-modal");

    contentEl.createEl("h2", { text: "Overwrite Existing File?" });
    contentEl.createEl("p", {
      text: `The file "${this.filePath}" already exists. Do you want to overwrite it?`,
    });

    const buttonContainer = contentEl.createDiv({
      cls: "daily-focus-button-container",
    });

    const cancelButton = buttonContainer.createEl("button", {
      text: "Cancel",
      cls: "daily-focus-button-secondary",
    });
    cancelButton.addEventListener("click", () => {
      this.close();
      this.resolvePromise?.(false);
    });

    const overwriteButton = buttonContainer.createEl("button", {
      text: "Overwrite",
      cls: "daily-focus-button-primary daily-focus-button-danger",
    });
    overwriteButton.addEventListener("click", () => {
      this.close();
      this.resolvePromise?.(true);
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
