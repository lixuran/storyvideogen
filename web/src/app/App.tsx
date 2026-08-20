import {useEffect, useMemo, useRef, useState, type MouseEvent} from "react";

interface RouteDefinition {
  path: string;
  label: string;
  icon: string;
  eyebrow: string;
  heading: string;
  description: string;
  admin?: boolean;
}

const routes: RouteDefinition[] = [
  {
    path: "/create",
    label: "Create",
    icon: "+",
    eyebrow: "Story workspace",
    heading: "Turn a long story into a visual podcast",
    description: "Paste the complete story, review every planned scene, and control each generated asset before rendering."
  },
  {
    path: "/library",
    label: "Library",
    icon: "▤",
    eyebrow: "Your work",
    heading: "Stories and podcast episodes",
    description: "Drafts, active generations, failures, and finished episodes will stay organized here."
  },
  {
    path: "/subscription",
    label: "Subscription",
    icon: "¥",
    eyebrow: "Plan and usage",
    heading: "Subscription",
    description: "Plan allowance, usage, WeChat payment, and order history will be available in this workspace."
  },
  {
    path: "/settings/providers",
    label: "Settings",
    icon: "⚙",
    eyebrow: "Account configuration",
    heading: "Provider settings",
    description: "Personal Zhipu and other provider credentials will be managed without revealing saved values."
  },
  {
    path: "/settings/account",
    label: "Account",
    icon: "○",
    eyebrow: "Security",
    heading: "Account settings",
    description: "Password and account-security controls will be available here."
  },
  {
    path: "/admin/users",
    label: "Users",
    icon: "◎",
    eyebrow: "Administration",
    heading: "User administration",
    description: "Role verification is required before administrative data can be displayed.",
    admin: true
  },
  {
    path: "/admin/stories",
    label: "All Stories",
    icon: "▤",
    eyebrow: "Administration",
    heading: "All stories",
    description: "Role verification is required before cross-user story metadata can be displayed.",
    admin: true
  },
  {
    path: "/admin/providers",
    label: "Service Keys",
    icon: "⌘",
    eyebrow: "Administration",
    heading: "Platform provider keys",
    description: "Role verification is required before platform credentials can be managed.",
    admin: true
  }
];

const publicNavigation = routes.filter((route) => !route.admin && route.path !== "/settings/account");

export function App() {
  const [pathname, setPathname] = useState(() => normalizedPath(window.location.pathname));
  const [navigationOpen, setNavigationOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (window.location.pathname === "/") {
      window.history.replaceState({}, "", "/create");
      setPathname("/create");
    }
    const onPopState = () => setPathname(normalizedPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && navigationOpen) {
        setNavigationOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigationOpen]);

  const activeRoute = useMemo(
    () => routes.find((route) => route.path === pathname),
    [pathname]
  );

  function navigate(event: MouseEvent<HTMLAnchorElement>, path: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    window.history.pushState({}, "", path);
    setPathname(path);
    setNavigationOpen(false);
  }

  return (
    <div className="app-shell">
      <button
        ref={menuButtonRef}
        className="mobile-menu-button"
        type="button"
        aria-controls="primary-navigation"
        aria-expanded={navigationOpen}
        onClick={() => setNavigationOpen((open) => !open)}
      >
        <span aria-hidden="true">☰</span>
        <span>{navigationOpen ? "Close navigation" : "Open navigation"}</span>
      </button>

      <aside id="primary-navigation" className="sidebar" data-open={navigationOpen ? "true" : "false"}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">S</span>
          <div className="brand-copy">
            <strong>StoryVideoGen</strong>
            <span>Podcast studio</span>
          </div>
        </div>

        <nav aria-label="Primary navigation">
          {publicNavigation.map((route) => (
            <a
              key={route.path}
              href={route.path}
              aria-label={route.label}
              aria-current={route.path === pathname ? "page" : undefined}
              title={route.label}
              onClick={(event) => navigate(event, route.path)}
            >
              <span className="nav-glyph" aria-hidden="true">{route.icon}</span>
              <span className="nav-label">{route.label}</span>
            </a>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="avatar" aria-hidden="true">P</span>
          <div className="sidebar-footer-copy">
            <strong>Preview user</strong>
            <a href="/settings/account" onClick={(event) => navigate(event, "/settings/account")}>Account</a>
          </div>
        </div>
      </aside>

      {navigationOpen ? <button className="scrim" type="button" aria-label="Close navigation" onClick={() => setNavigationOpen(false)} /> : null}

      <main className="main-content">
        {activeRoute ? <PlaceholderPage route={activeRoute} /> : <NotFoundPage navigate={navigate} />}
      </main>
    </div>
  );
}

function PlaceholderPage({route}: {route: RouteDefinition}) {
  return (
    <section className="page" aria-labelledby="page-heading">
      <header className="page-header">
        <div>
          <p className="eyebrow">{route.eyebrow}</p>
          <h1 id="page-heading">{route.heading}</h1>
          <p className="page-description">{route.description}</p>
        </div>
        <span className="status-chip">Foundation preview</span>
      </header>

      <div className="placeholder-grid">
        <article className="surface surface-primary">
          <p className="eyebrow">Current milestone</p>
          <h2>Application foundation</h2>
          <p>This route is ready for its feature service, persistent data, and workflow states in the next implementation slices.</p>
          <div className="progress-track" aria-label="Foundation progress">
            <span />
          </div>
        </article>
        <article className="surface">
          <p className="eyebrow">Runtime</p>
          <dl className="fact-list">
            <div><dt>Web</dt><dd>Node + React</dd></div>
            <div><dt>Media</dt><dd>Private Python worker</dd></div>
            <div><dt>Storage</dt><dd>SQLite + local disk</dd></div>
          </dl>
        </article>
      </div>
    </section>
  );
}

function NotFoundPage({navigate}: {navigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void}) {
  return (
    <section className="page not-found" aria-labelledby="page-heading">
      <p className="eyebrow">404</p>
      <h1 id="page-heading">Page not found</h1>
      <p className="page-description">The address is not part of the StoryVideoGen workspace.</p>
      <a className="primary-link" href="/create" onClick={(event) => navigate(event, "/create")}>Return to Create</a>
    </section>
  );
}

function normalizedPath(pathname: string): string {
  if (pathname === "/") {
    return "/create";
  }
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}
