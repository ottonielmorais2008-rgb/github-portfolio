import { useEffect, useMemo, useState } from "react";
import { ALL, filterByLanguage, languagesOf, type Activity, type PortfolioData, type Project } from "./lib/transform";

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});

function formatDate(iso: string) {
  return dateFmt.format(new Date(iso));
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <article className="card">
      <header className="card-head">
        <h3>{project.name}</h3>
        {project.stars > 0 && <span className="stars" title="Stars">★ {project.stars}</span>}
      </header>
      <p className="desc">{project.description || "No description yet."}</p>
      {project.topics.length > 0 && (
        <ul className="topics" aria-label="Topics">
          {project.topics.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      <footer className="card-foot">
        <span className="meta">
          {project.language && <span className="lang">{project.language}</span>}
          <span>Updated {formatDate(project.updatedAt)}</span>
        </span>
        <span className="links">
          {project.homepage && (
            <a className="btn primary" href={project.homepage} target="_blank" rel="noopener noreferrer">
              Live demo
            </a>
          )}
          <a className="btn" href={project.codeUrl} target="_blank" rel="noopener noreferrer">
            Code
          </a>
        </span>
      </footer>
    </article>
  );
}

function ActivityList({ items }: { items: Activity[] }) {
  if (items.length === 0) return <p className="muted">No recent public activity.</p>;
  return (
    <ol className="activity">
      {items.map((a) => (
        <li key={a.id}>
          <time dateTime={a.date}>{formatDate(a.date)}</time>
          <div>
            <a href={a.url} target="_blank" rel="noopener noreferrer">
              {a.summary}
            </a>
            <span className="repo">{a.repo.split("/")[1]}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function App() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState(ALL);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data.json`, { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PortfolioData>;
      })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  const languages = useMemo(() => (data ? languagesOf(data.projects) : []), [data]);
  const visible = useMemo(() => (data ? filterByLanguage(data.projects, language) : []), [data, language]);
  const profileUrl = `https://github.com/${data?.username ?? "ottonielmorais2008-rgb"}`;

  return (
    <div className="page">
      <header className="hero">
        <h1>Ottoniel Morais</h1>
        <p className="tagline">
          I build practical projects in networking, AI and crypto — from VPNs and homelab monitoring to LLM tools and
          Solana apps.
        </p>
        <nav className="hero-links">
          <a className="btn" href={profileUrl} target="_blank" rel="noopener noreferrer">
            GitHub profile
          </a>
        </nav>
      </header>

      {error && <p className="error">Could not load project data ({error}).</p>}
      {!data && !error && <p className="muted">Loading projects…</p>}

      {data && (
        <main className="layout">
          <section aria-labelledby="projects-title">
            <div className="section-head">
              <h2 id="projects-title">
                Projects <span className="count">{visible.length}</span>
              </h2>
              <div className="filters" role="group" aria-label="Filter by language">
                {[ALL, ...languages].map((l) => (
                  <button
                    key={l}
                    type="button"
                    className={l === language ? "chip active" : "chip"}
                    aria-pressed={l === language}
                    onClick={() => setLanguage(l)}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid">
              {visible.map((p) => (
                <ProjectCard key={p.name} project={p} />
              ))}
            </div>
          </section>

          <aside aria-labelledby="activity-title" className="side">
            <h2 id="activity-title">Recent activity</h2>
            <ActivityList items={data.activity} />
          </aside>
        </main>
      )}

      <footer className="site-foot">
        {data && (
          <p>
            Last updated <time dateTime={data.generatedAt}>{dateTimeFmt.format(new Date(data.generatedAt))}</time> ·
            rebuilt daily from the GitHub API
          </p>
        )}
        <p>
          <a href="https://github.com/ottonielmorais2008-rgb/github-portfolio" target="_blank" rel="noopener noreferrer">
            Source code
          </a>
        </p>
      </footer>
    </div>
  );
}
