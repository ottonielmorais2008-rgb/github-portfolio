import { describe, expect, it } from "vitest";
import {
  ALL,
  buildData,
  filterByLanguage,
  filterRepos,
  languagesOf,
  mapEvent,
  mapRepo,
  safeHomepage,
  sortProjects,
  toActivity,
  toProjects,
  type Project,
  type RawEvent,
  type RawRepo,
} from "./transform";

const USER = "octo-user";

function repo(overrides: Partial<RawRepo> = {}): RawRepo {
  const name = overrides.name ?? "demo";
  return {
    name,
    full_name: `${USER}/${name}`,
    html_url: `https://github.com/${USER}/${name}`,
    description: "A demo",
    language: "TypeScript",
    topics: ["b", "a"],
    stargazers_count: 0,
    homepage: null,
    fork: false,
    archived: false,
    private: false,
    visibility: "public",
    pushed_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function event(overrides: Partial<RawEvent> & Pick<RawEvent, "type">): RawEvent {
  return {
    id: "1",
    public: true,
    created_at: "2026-01-01T00:00:00Z",
    repo: { name: `${USER}/demo` },
    payload: {},
    ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    name: "p",
    description: "",
    language: "TypeScript",
    topics: [],
    stars: 0,
    homepage: null,
    codeUrl: "https://github.com/x/p",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("filterRepos", () => {
  it("drops forks, archived, private and the profile repo", () => {
    const repos = [
      repo({ name: "keep" }),
      repo({ name: "forked", fork: true }),
      repo({ name: "old", archived: true }),
      repo({ name: "secret", private: true, visibility: "private" }),
      repo({ name: "internal", visibility: "internal" }),
      repo({ name: USER }),
      repo({ name: USER.toUpperCase() }),
    ];
    expect(filterRepos(repos, USER).map((r) => r.name)).toEqual(["keep"]);
  });
});

describe("safeHomepage", () => {
  it.each([
    [null, null],
    ["", null],
    ["   ", null],
    ["http://localhost:5173", null],
    ["https://app.localhost/", null],
    ["http://127.0.0.1:3000", null],
    ["http://192.168.1.10", null],
    ["http://10.0.0.5", null],
    ["http://172.20.0.1", null],
    ["ftp://example.com", null],
    ["javascript:alert(1)", null],
    ["https://example.com", "https://example.com/"],
    ["example.vercel.app", "https://example.vercel.app/"],
    ["https://user.github.io/repo/", "https://user.github.io/repo/"],
  ])("%s -> %s", (input, expected) => {
    expect(safeHomepage(input)).toBe(expected);
  });
});

describe("mapRepo", () => {
  it("maps API fields and sorts topics", () => {
    const p = mapRepo(
      repo({
        name: "app",
        description: "  Hello  ",
        stargazers_count: 3,
        homepage: "https://app.example.com",
        pushed_at: "2026-02-02T00:00:00Z",
      }),
    );
    expect(p).toEqual({
      name: "app",
      description: "Hello",
      language: "TypeScript",
      topics: ["a", "b"],
      stars: 3,
      homepage: "https://app.example.com/",
      codeUrl: `https://github.com/${USER}/app`,
      updatedAt: "2026-02-02T00:00:00Z",
    });
  });

  it("handles missing description, topics and pushed_at", () => {
    const p = mapRepo(repo({ description: null, topics: undefined, pushed_at: null, updated_at: "2026-03-03T00:00:00Z" }));
    expect(p.description).toBe("");
    expect(p.topics).toEqual([]);
    expect(p.updatedAt).toBe("2026-03-03T00:00:00Z");
  });
});

describe("sortProjects", () => {
  it("sorts by update date, then stars, then name, without mutating input", () => {
    const input = [
      project({ name: "old", updatedAt: "2025-01-01T00:00:00Z" }),
      project({ name: "b", updatedAt: "2026-01-01T00:00:00Z", stars: 1 }),
      project({ name: "a", updatedAt: "2026-01-01T00:00:00Z", stars: 1 }),
      project({ name: "starred", updatedAt: "2026-01-01T00:00:00Z", stars: 5 }),
      project({ name: "new", updatedAt: "2026-06-01T00:00:00Z" }),
    ];
    const before = input.map((p) => p.name);
    expect(sortProjects(input).map((p) => p.name)).toEqual(["new", "starred", "a", "b", "old"]);
    expect(input.map((p) => p.name)).toEqual(before);
  });

  it("toProjects filters then sorts", () => {
    const out = toProjects(
      [
        repo({ name: "x", pushed_at: "2025-01-01T00:00:00Z" }),
        repo({ name: "y", pushed_at: "2026-01-01T00:00:00Z" }),
        repo({ name: "z", fork: true }),
      ],
      USER,
    );
    expect(out.map((p) => p.name)).toEqual(["y", "x"]);
  });
});

describe("mapEvent", () => {
  it("summarises a push with commits", () => {
    const a = mapEvent(
      event({
        type: "PushEvent",
        payload: {
          ref: "refs/heads/main",
          size: 3,
          commits: [
            { sha: "aaa", message: "first" },
            { sha: "bbb", message: "Add feature\n\nlong body" },
          ],
        },
      }),
    );
    expect(a?.summary).toBe('Pushed "Add feature" (+2 more) to main');
    expect(a?.url).toBe(`https://github.com/${USER}/demo/commit/bbb`);
  });

  it("falls back when the push payload has no commits (current API shape)", () => {
    const a = mapEvent(event({ type: "PushEvent", payload: { ref: "refs/heads/main", head: "ccc" } }));
    expect(a?.summary).toBe("Pushed to main");
    expect(a?.url).toBe(`https://github.com/${USER}/demo/commit/ccc`);
  });

  it("skips merge-commit pushes that duplicate a merged PR", () => {
    const e = event({
      type: "PushEvent",
      payload: { ref: "refs/heads/main", commits: [{ sha: "d", message: "Merge pull request #1 from x/y" }] },
    });
    expect(mapEvent(e)).toBeNull();
  });

  it("summarises pull requests, releases, tags and new repos", () => {
    expect(
      mapEvent(event({ type: "PullRequestEvent", payload: { action: "merged", pull_request: { number: 2, title: "Add tests" } } })),
    ).toMatchObject({ summary: "Merged pull request #2: Add tests", url: `https://github.com/${USER}/demo/pull/2` });
    expect(mapEvent(event({ type: "ReleaseEvent", payload: { release: { tag_name: "v1.0.0" } } }))?.summary).toBe(
      "Released v1.0.0",
    );
    expect(mapEvent(event({ type: "CreateEvent", payload: { ref_type: "tag", ref: "v2" } }))?.summary).toBe("Tagged v2");
    expect(mapEvent(event({ type: "CreateEvent", payload: { ref_type: "repository" } }))?.summary).toBe(
      "Created repository",
    );
  });

  it("ignores noise and non-public events", () => {
    expect(mapEvent(event({ type: "WatchEvent", payload: { action: "started" } }))).toBeNull();
    expect(mapEvent(event({ type: "CreateEvent", payload: { ref_type: "branch", ref: "feat" } }))).toBeNull();
    expect(mapEvent(event({ type: "DeleteEvent" }))).toBeNull();
    expect(mapEvent(event({ type: "PublicEvent", public: false }))).toBeNull();
  });
});

describe("toActivity", () => {
  it("keeps allowed repos only, newest first, limited", () => {
    const events = [
      event({ id: "1", type: "PublicEvent", created_at: "2026-01-01T00:00:00Z" }),
      event({ id: "2", type: "PublicEvent", created_at: "2026-03-01T00:00:00Z" }),
      event({ id: "3", type: "PublicEvent", created_at: "2026-02-01T00:00:00Z" }),
      event({ id: "4", type: "PublicEvent", created_at: "2026-04-01T00:00:00Z", repo: { name: "someone/else" } }),
    ];
    const out = toActivity(events, 2, new Set([`${USER}/demo`]));
    expect(out.map((a) => a.id)).toEqual(["2", "3"]);
  });
});

describe("buildData", () => {
  it("produces projects, activity limited to listed repos and a timestamp", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    const data = buildData(
      [repo({ name: "demo" }), repo({ name: "fork", fork: true })],
      [
        event({ id: "a", type: "PublicEvent" }),
        event({ id: "b", type: "PublicEvent", repo: { name: `${USER}/fork` } }),
      ],
      now,
      USER,
    );
    expect(data.generatedAt).toBe("2026-11-03T12:00:00.000Z");
    expect(data.username).toBe(USER);
    expect(data.projects.map((p) => p.name)).toEqual(["demo"]);
    expect(data.activity.map((a) => a.id)).toEqual(["a"]);
  });
});

describe("languages", () => {
  const ps = [
    project({ name: "1", language: "TypeScript" }),
    project({ name: "2", language: "Shell" }),
    project({ name: "3", language: "TypeScript" }),
    project({ name: "4", language: null }),
    project({ name: "5", language: "Go" }),
  ];

  it("languagesOf orders by count then name and skips null", () => {
    expect(languagesOf(ps)).toEqual(["TypeScript", "Go", "Shell"]);
  });

  it("filterByLanguage", () => {
    expect(filterByLanguage(ps, ALL)).toHaveLength(5);
    expect(filterByLanguage(ps, "TypeScript").map((p) => p.name)).toEqual(["1", "3"]);
  });
});
