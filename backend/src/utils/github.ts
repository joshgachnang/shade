import {Octokit} from "@octokit/rest";
import {logger} from "@terreno/api";

export interface GitHubPR {
  repo: string;
  prNumber: number;
  title: string;
  url: string;
  branch: string;
  baseBranch: string;
  isDraft: boolean;
  state: "open" | "closed";
  merged: boolean;
}

export interface GitHubPRDetails {
  mergeable: boolean | null;
  mergeableState: string;
  hasConflicts: boolean;
  isDraft: boolean;
  headSha: string;
}

export interface GitHubReview {
  reviewer: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  body: string;
  submittedAt: string;
  isBot: boolean;
}

export interface GitHubCheckRun {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  detailsUrl: string;
}

export interface ConditionalResult<T> {
  data: T | null;
  etag: string | null;
  notModified: boolean;
}

export class GitHubClient {
  private octokit: Octokit;
  private etagCache = new Map<string, string>();

  constructor(token: string) {
    this.octokit = new Octokit({auth: token});
  }

  async getMyOpenPRs(username: string): Promise<GitHubPR[]> {
    try {
      const result = await this.octokit.search.issuesAndPullRequests({
        q: `author:${username} is:pr is:open`,
        per_page: 100,
        sort: "updated",
        order: "desc",
      });

      return result.data.items.map((item) => {
        const repoUrl = item.repository_url;
        const repo = repoUrl.replace("https://api.github.com/repos/", "");
        return {
          repo,
          prNumber: item.number,
          title: item.title,
          url: item.html_url,
          branch: (item.pull_request as any)?.head?.ref || "",
          baseBranch: (item.pull_request as any)?.base?.ref || "",
          isDraft: item.draft || false,
          state: item.state as "open" | "closed",
          merged: false,
        };
      });
    } catch (err) {
      logger.error(`Failed to fetch open PRs for ${username}: ${err}`);
      return [];
    }
  }

  async getPRDetails(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ConditionalResult<GitHubPRDetails>> {
    const cacheKey = `pr:${owner}/${repo}/${prNumber}`;
    const cachedEtag = this.etagCache.get(cacheKey);

    try {
      const headers: Record<string, string> = {};
      if (cachedEtag) {
        headers["if-none-match"] = cachedEtag;
      }

      const result = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
        headers,
      });

      const etag = result.headers.etag || null;
      if (etag) {
        this.etagCache.set(cacheKey, etag);
      }

      return {
        data: {
          mergeable: result.data.mergeable,
          mergeableState: result.data.mergeable_state,
          hasConflicts: result.data.mergeable_state === "dirty",
          isDraft: result.data.draft || false,
          headSha: result.data.head.sha,
        },
        etag,
        notModified: false,
      };
    } catch (err: any) {
      if (err.status === 304) {
        return {data: null, etag: cachedEtag || null, notModified: true};
      }
      logger.error(`Failed to fetch PR details for ${owner}/${repo}#${prNumber}: ${err}`);
      return {data: null, etag: null, notModified: false};
    }
  }

  async getPRReviews(owner: string, repo: string, prNumber: number): Promise<GitHubReview[]> {
    try {
      const result = await this.octokit.pulls.listReviews({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });

      return result.data.map((review) => ({
        reviewer: review.user?.login || "unknown",
        state: review.state as GitHubReview["state"],
        body: review.body || "",
        submittedAt: review.submitted_at || "",
        isBot: review.user?.type === "Bot",
      }));
    } catch (err) {
      logger.error(`Failed to fetch reviews for ${owner}/${repo}#${prNumber}: ${err}`);
      return [];
    }
  }

  async getPRChecks(owner: string, repo: string, ref: string): Promise<GitHubCheckRun[]> {
    try {
      const result = await this.octokit.checks.listForRef({
        owner,
        repo,
        ref,
        per_page: 100,
      });

      return result.data.check_runs.map((run) => ({
        name: run.name,
        status: run.status as GitHubCheckRun["status"],
        conclusion: (run.conclusion as string) || null,
        detailsUrl: run.details_url || run.html_url || "",
      }));
    } catch (err) {
      logger.error(`Failed to fetch check runs for ${owner}/${repo}@${ref}: ${err}`);
      return [];
    }
  }

  async postReviewComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<void> {
    try {
      await this.octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
      });
    } catch (err) {
      logger.error(`Failed to post comment on ${owner}/${repo}#${prNumber}: ${err}`);
    }
  }
}
