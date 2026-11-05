// Pure data-transform logic shared by the build-time fetch script and the UI.

export const USERNAME = "ottonielmorais2008-rgb";

/** Subset of the GitHub REST "repository" object we rely on. */
export interface RawRepo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  topics?: string[];
  stargazers_count: number;
  homepage: string | null;
  fork: boolean;
  archived: boolean;
  private: boolean;
  visibility?: string;
  pushed_at: string | null;
  updated_at: string;
}

/** Subset of the GitHub REST "event" object we rely on. */
export interface RawEvent {
  id: string;
  type: string;
  public?: boolean;
  created_at: string;
  repo: { name: string };
  payload: {
    ref?: string | null;
    ref_type?: string;
    head?: string;
    size?: number;
    commits?: { sha: string; message: string }[];
    action?: string;
    pull_request?: { number?: number; title?: string; html_url?: string };
    release?: { tag_name?: string; name?: string | null };
  };
}

export interface Project {
  name: string;
  description: string;
  language: string | null;
  topics: string[];
  stars: number;
  homepage: string | null;
  codeUrl: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  type: string;
  repo: string;
  summary: string;
  url: string;
  date: string;
}

export interface PortfolioData {
  generatedAt: string;
  username: string;
  projects: Project[];
  activity: Activity[];
}

/** Keep only public, non-fork, non-archived repos and drop the profile README repo. */
export function filterRepos(repos: RawRepo[], username: string = USERNAME): RawRepo[] {
  return repos.filter(
    (r) =>
      !r.private &&
      (r.visibility === undefined || r.visibility === "public") &&
      !r.fork &&
      !r.archived &&
      r.name.toLowerCase() !== username.toLowerCase(),
  );
}

/** Return a usable public demo URL, or null (empty, invalid, non-http or localhost). */
export function safeHomepage(url: string | null | undefined): string | null {
  if (!url) return null;
  let raw = url.trim();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return null;
  }
  return parsed.toString();
}

export function mapRepo(repo: RawRepo): Project {
  return {
    name: repo.name,
    description: repo.description?.trim() ?? "",
    language: repo.language,
    topics: [...(repo.topics ?? [])].sort(),
    stars: repo.stargazers_count,
    homepage: safeHomepage(repo.homepage),
    codeUrl: repo.html_url,
    updatedAt: repo.pushed_at ?? repo.updated_at,
  };
}

/** Most recently updated first; ties broken by stars, then name. */
export function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort(
    (a, b) =>
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      b.stars - a.stars ||
      a.name.localeCompare(b.name),
  );
}

export function toProjects(repos: RawRepo[], username: string = USERNAME): Project[] {
  return sortProjects(filterRepos(repos, username).map(mapRepo));
}

function firstLine(message: string): string {
  return message.split("\n")[0].trim();
}

/** Turn one public event into a short human-readable activity entry, or null to skip it. */
export function mapEvent(event: RawEvent): Activity | null {
  if (event.public === false) return null;
  const repo = event.repo.name;
  const repoUrl = `https://github.com/${repo}`;
  const p = event.payload ?? {};
  const base = { id: event.id, type: event.type, repo, date: event.created_at };

  switch (event.type) {
    case "PushEvent": {
      const branch = (p.ref ?? "").replace(/^refs\/heads\//, "");
      const commits = p.commits ?? [];
      const count = p.size ?? commits.length;
      const last = commits[commits.length - 1];
      // A merge commit pushed by GitHub duplicates the "Merged pull request" entry.
      if (last && /^Merge pull request #\d+/.test(last.message)) return null;
      const summary = last
        ? `Pushed "${firstLine(last.message)}"${count > 1 ? ` (+${count - 1} more)` : ""}${branch ? ` to ${branch}` : ""}`
        : `Pushed${count ? ` ${count} commit${count === 1 ? "" : "s"}` : ""}${branch ? ` to ${branch}` : ""}`;
      const url = last
        ? `${repoUrl}/commit/${last.sha}`
        : p.head
          ? `${repoUrl}/commit/${p.head}`
          : repoUrl;
      return { ...base, summary, url };
    }
    case "CreateEvent":
      if (p.ref_type === "repository") return { ...base, summary: "Created repository", url: repoUrl };
      if (p.ref_type === "tag" && p.ref) return { ...base, summary: `Tagged ${p.ref}`, url: `${repoUrl}/tree/${p.ref}` };
      // New branches are noise on a portfolio page.
      return null;
    case "PullRequestEvent": {
      const pr = p.pull_request ?? {};
      const action = p.action ?? "updated";
      const title = pr.title ? `: ${pr.title}` : "";
      return {
        ...base,
        summary: `${action[0].toUpperCase()}${action.slice(1)} pull request${pr.number ? ` #${pr.number}` : ""}${title}`,
        url: pr.html_url ?? (pr.number ? `${repoUrl}/pull/${pr.number}` : repoUrl),
      };
    }
    case "ReleaseEvent":
      return {
        ...base,
        summary: `Released ${p.release?.name || p.release?.tag_name || "a new version"}`,
        url: `${repoUrl}/releases`,
      };
    case "PublicEvent":
      return { ...base, summary: "Made repository public", url: repoUrl };
    default:
      return null;
  }
}

/**
 * Map public events to activity entries, newest first.
 * Only events on repos in `allowedRepos` (full names) are kept when the set is given,
 * so nothing about a fork, archived or non-listed repo leaks onto the page.
 */
export function toActivity(events: RawEvent[], limit = 15, allowedRepos?: Set<string>): Activity[] {
  return events
    .filter((e) => !allowedRepos || allowedRepos.has(e.repo.name.toLowerCase()))
    .map(mapEvent)
    .filter((a): a is Activity => a !== null)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, limit);
}

export function buildData(
  repos: RawRepo[],
  events: RawEvent[],
  now: Date = new Date(),
  username: string = USERNAME,
): PortfolioData {
  const kept = filterRepos(repos, username);
  const allowed = new Set(kept.map((r) => r.full_name.toLowerCase()));
  return {
    generatedAt: now.toISOString(),
    username,
    projects: sortProjects(kept.map(mapRepo)),
    activity: toActivity(events, 15, allowed),
  };
}

/** Distinct languages, most common first, then alphabetical. */
export function languagesOf(projects: Project[]): string[] {
  const counts = new Map<string, number>();
  for (const p of projects) if (p.language) counts.set(p.language, (counts.get(p.language) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
}

export const ALL = "All";

export function filterByLanguage(projects: Project[], language: string): Project[] {
  return language === ALL ? projects : projects.filter((p) => p.language === language);
}
