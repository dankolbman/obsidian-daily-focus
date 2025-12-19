/**
 * Cursor deeplink helpers.
 *
 * Docs: https://cursor.com/docs/integrations/deeplinks
 */

function extractJiraId(text: string): string | null {
  const match = text.match(/\[([A-Z]+-\d+)\]/);
  return match ? match[1] : null;
}

export function buildCursorDelegationPrompt(task: string, extraContext?: string): string {
  const jiraId = extractJiraId(task);
  const jiraLine = jiraId ? `- Jira: ${jiraId}\n` : "";
  const extra = extraContext?.trim() ? extraContext.trim() : "";

  return `You are an autonomous coding agent working in Cursor.

Task:
- ${task}
${jiraLine}
Context (from me):
${extra ? extra : "- (none provided)"}

Constraints:
- Prefer making the smallest high-leverage change that fully solves the problem.
- If requirements are ambiguous, ask 1-3 clarifying questions; otherwise proceed.
- Keep changes safe and reversible; avoid large refactors unless necessary.

What I want back:
- A short plan
- The code changes (with file paths)
- How you verified it (build/tests/manual steps)
- A concise summary + any follow-ups I should do
`;
}

export function generateCursorPromptDeeplink(promptText: string): string {
  // We avoid URLSearchParams here because it encodes spaces as '+', and Cursor deeplinks
  // appear to expect standard percent-encoding (spaces as '%20').
  const baseUrl = "cursor://anysphere.cursor-deeplink/prompt";
  return `${baseUrl}?text=${encodeURIComponent(promptText)}`;
}

export function generateCursorDeeplinkForTask(task: string, extraContext?: string): string {
  return generateCursorPromptDeeplink(buildCursorDelegationPrompt(task, extraContext));
}
