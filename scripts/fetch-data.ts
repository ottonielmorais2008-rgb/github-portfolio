// Build-time script: fetches PUBLIC repos and PUBLIC events for the user
// and writes public/data.json. Uses GITHUB_TOKEN if present (only to raise
// rate limits); it always calls the public endpoints, so private data never
// comes back.
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildData,
  filterRepos,
  mapEvent,
  USERNAME,
  type RawEvent,
  type RawRepo,
} from "../src/lib/transform";

const username = process.env.GITHUB_USERNAME ?? USERNAME;
const token = process.env.GITHUB_TOKEN;
const outFile = resolve(dirname(fileURLToPath(import.meta.url)), "../public/data.json");

const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "github-portfolio-build",
};
if (token) headers.Authorization = `Bearer ${token}`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

async function fetchAllRepos(): Promise<RawRepo[]> {
  const all: RawRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    // /users/{user}/repos only ever returns public repositories.
    const batch = await getJson<RawRepo[]>(
      `https://api.github.com/users/${username}/repos?type=owner&sort=pushed&per_page=100&page=${page}`,
    );
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

const ACTIVITY_LIMIT = 15;

/**
 * Since 2025 the public events API no longer includes commit messages in
 * PushEvent payloads, nor titles in PullRequestEvent payloads. For the few
 * events we actually show, look those up from the public repo endpoints.
 * Failures are ignored: the entry simply falls back to a shorter summary.
 */
async function enrichEvents(events: RawEvent[], repos: RawRepo[]): Promise<RawEvent[]> {
  const allowed = new Set(filterRepos(repos, username).map((r) => r.full_name.toLowerCase()));
  const shown = events
    .filter((e) => allowed.has(e.repo.name.toLowerCase()) && mapEvent(e) !== null)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, ACTIVITY_LIMIT * 2); // headroom: some pushes turn out to be PR merge commits and get dropped

  return Promise.all(
    shown.map(async (e) => {
      try {
        if (e.type === "PushEvent" && e.payload.head && !e.payload.commits?.length) {
          const c = await getJson<{ sha: string; commit: { message: string } }>(
            `https://api.github.com/repos/${e.repo.name}/commits/${e.payload.head}`,
          );
          return { ...e, payload: { ...e.payload, commits: [{ sha: c.sha, message: c.commit.message }] } };
        }
        const pr = e.payload.pull_request;
        const number = pr?.number ?? (e.payload as { number?: number }).number;
        if (e.type === "PullRequestEvent" && number && !pr?.title) {
          const full = await getJson<{ number: number; title: string; html_url: string }>(
            `https://api.github.com/repos/${e.repo.name}/pulls/${number}`,
          );
          return {
            ...e,
            payload: { ...e.payload, pull_request: { number, title: full.title, html_url: full.html_url } },
          };
        }
      } catch (err) {
        console.warn(`Could not enrich event ${e.id}: ${(err as Error).message.split("\n")[0]}`);
      }
      return e;
    }),
  );
}

async function main() {
  const [repos, events] = await Promise.all([
    fetchAllRepos(),
    // /users/{user}/events/public returns public events only.
    getJson<RawEvent[]>(`https://api.github.com/users/${username}/events/public?per_page=100`),
  ]);
  const enriched = await enrichEvents(events, repos);
  const data = buildData(repos, enriched, new Date(), username);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(data, null, 2) + "\n");
  console.log(
    `Wrote ${outFile}: ${data.projects.length} projects, ${data.activity.length} activity items (token: ${token ? "yes" : "no"})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
