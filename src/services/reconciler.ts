import { PullRequest, JiraTicket, ReconciliationResult, ReconciliationWarning } from "../types";

/**
 * Service for reconciling GitHub PRs with Jira tickets.
 * Matches PRs to tickets and identifies discrepancies.
 */
export class Reconciler {
  /**
   * Reconcile PRs with Jira tickets.
   * Matches based on Jira ID in PR title.
   */
  reconcile(pullRequests: PullRequest[], tickets: JiraTicket[]): ReconciliationResult {
    console.log(
      "[DailyFocus] Reconciling",
      pullRequests.length,
      "PRs with",
      tickets.length,
      "tickets"
    );

    const warnings: ReconciliationWarning[] = [];
    const matchedPRs: PullRequest[] = [];
    const matchedTickets: JiraTicket[] = [];
    const unmatchedPRs: PullRequest[] = [];
    const unmatchedTickets: JiraTicket[] = [];

    // Create a map of ticket keys for quick lookup
    const ticketMap = new Map<string, JiraTicket>();
    for (const ticket of tickets) {
      ticketMap.set(ticket.key.toUpperCase(), { ...ticket });
    }

    // Match PRs to tickets
    for (const pr of pullRequests) {
      if (pr.jiraId) {
        const ticket = ticketMap.get(pr.jiraId.toUpperCase());

        if (ticket) {
          // PR matched to ticket
          ticket.hasLinkedPR = true;
          ticket.linkedPRNumber = pr.number;
          matchedPRs.push(pr);

          // Check for status discrepancies
          this.checkStatusDiscrepancies(pr, ticket, warnings);
        } else {
          // PR has Jira ID but ticket not in our list (not In Progress/In Review)
          unmatchedPRs.push(pr);
          warnings.push({
            type: "pr_no_ticket",
            message: `PR #${pr.number} references ${pr.jiraId} but ticket is not "In Progress" or "In Review"`,
            prNumber: pr.number,
            jiraKey: pr.jiraId,
          });
        }
      } else {
        // PR has no Jira ID
        unmatchedPRs.push(pr);
        warnings.push({
          type: "pr_no_ticket",
          message: `PR #${pr.number} "${pr.title}" has no Jira ticket ID in title`,
          prNumber: pr.number,
        });
      }
    }

    // Find tickets without PRs
    for (const ticket of tickets) {
      if (ticket.hasLinkedPR) {
        matchedTickets.push(ticket);
      } else {
        unmatchedTickets.push(ticket);

        // Only warn for "In Review" tickets without PRs
        if (ticket.status === "In Review") {
          warnings.push({
            type: "ticket_no_pr",
            message: `${ticket.key} is "In Review" but has no open PR`,
            jiraKey: ticket.key,
          });
        }
      }
    }

    console.log("[DailyFocus] Reconciliation complete:", {
      matchedPRs: matchedPRs.length,
      matchedTickets: matchedTickets.length,
      unmatchedPRs: unmatchedPRs.length,
      unmatchedTickets: unmatchedTickets.length,
      warnings: warnings.length,
    });

    return {
      matchedPRs,
      matchedTickets,
      unmatchedPRs,
      unmatchedTickets,
      warnings,
    };
  }

  /**
   * Check for status discrepancies between a PR and its linked ticket.
   */
  private checkStatusDiscrepancies(
    pr: PullRequest,
    ticket: JiraTicket,
    warnings: ReconciliationWarning[]
  ): void {
    // Ticket is "In Review" but PR doesn't have approval
    if (ticket.status === "In Review" && !pr.hasApproval) {
      warnings.push({
        type: "needs_approval",
        message: `${ticket.key} is "In Review" but PR #${pr.number} needs approval`,
        prNumber: pr.number,
        jiraKey: ticket.key,
      });
    }

    // PR has approval but ticket is still "In Progress"
    if (pr.hasApproval && ticket.status === "In Progress") {
      warnings.push({
        type: "status_mismatch",
        message: `PR #${pr.number} is approved but ${ticket.key} is still "In Progress" - consider moving to "In Review"`,
        prNumber: pr.number,
        jiraKey: ticket.key,
      });
    }

    // HIL checks failing
    if (pr.hilChecksPassing === false) {
      warnings.push({
        type: "status_mismatch",
        message: `PR #${pr.number} (${ticket.key}) has failing HIL checks`,
        prNumber: pr.number,
        jiraKey: ticket.key,
      });
    }
  }
}
