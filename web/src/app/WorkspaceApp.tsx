import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";

interface User {
  id: string;
  username: string;
  role: "user" | "admin";
}
interface RouteDefinition {
  path: string;
  label: string;
  icon: string;
  eyebrow: string;
  heading: string;
  description: string;
  admin?: boolean;
}
interface ProviderStatus {
  id: string;
  label: string;
  capabilities: { text: boolean; image: boolean; search: boolean };
  configured: boolean;
  lastFour: string | null;
  status: string;
  textTestStatus: string;
  imageTestStatus: string;
}
interface Prompt {
  id: string;
  promptText: string;
  version: number;
  provider: string | null;
  model: string | null;
}
interface Scene {
  id: string;
  position: number;
  sourceText: string;
  narrationText: string;
  version: number;
  prompts: Prompt[];
}
interface Story {
  id: string;
  name: string;
  sourceText: string;
  status: string;
  version: number;
  wordCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  updatedAt: string;
  archivedAt: string | null;
  scenes?: Scene[];
}
interface StoryList {
  items: Story[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
interface PublicAsset {
  id: string;
  storyId?: string | null;
  sceneId?: string | null;
  kind: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs?: number | null;
  url: string;
  downloadUrl: string;
}
interface ImageCandidate {
  id: string;
  sceneId: string;
  promptId: string | null;
  provider: string;
  model: string | null;
  status: string;
  isSelected: boolean;
  attributionText: string | null;
  licenseCode: string | null;
  sourceUrl: string | null;
  errorMessage: string | null;
  asset: PublicAsset | null;
}
interface Job {
  id: string;
  type?: string;
  state: string;
  progress: number;
  attempt: number;
  maxAttempts: number;
  errorMessage: string | null;
}
interface AutomationStatus {
  state: "idle" | "active" | "completed" | "failed";
  storyStatus: string;
  errorCode: string | null;
  errorMessage: string | null;
  currentJob: Job | null;
  jobCount: number;
}

const routes: RouteDefinition[] = [
  {
    path: "/create",
    label: "Create",
    icon: "+",
    eyebrow: "Story workspace",
    heading: "Turn a long story into a visual podcast",
    description:
      "Paste the complete story, review every planned scene, and control each generated asset before rendering.",
  },
  {
    path: "/library",
    label: "Library",
    icon: "▤",
    eyebrow: "Your work",
    heading: "Stories and podcast episodes",
    description:
      "Drafts, active generations, failures, and finished episodes will stay organized here.",
  },
  {
    path: "/subscription",
    label: "Subscription",
    icon: "¥",
    eyebrow: "Plan and usage",
    heading: "Subscription",
    description:
      "Plan allowance, usage, WeChat payment, and order history will be available in this workspace.",
  },
  {
    path: "/settings/providers",
    label: "Settings",
    icon: "⚙",
    eyebrow: "Account configuration",
    heading: "Provider settings",
    description:
      "Add personal provider credentials. Saved values are encrypted and never shown again.",
  },
  {
    path: "/settings/account",
    label: "Account",
    icon: "○",
    eyebrow: "Security",
    heading: "Account settings",
    description: "Change your password and manage the current session.",
  },
  {
    path: "/admin/users",
    label: "Users",
    icon: "◎",
    eyebrow: "Administration",
    heading: "User administration",
    description: "Review registered users and their access level.",
    admin: true,
  },
  {
    path: "/admin/stories",
    label: "All Stories",
    icon: "▤",
    eyebrow: "Administration",
    heading: "All stories",
    description:
      "Cross-user story metadata will be connected with the story workflow.",
    admin: true,
  },
  {
    path: "/admin/providers",
    label: "Service Keys",
    icon: "⌘",
    eyebrow: "Administration",
    heading: "Platform provider keys",
    description: "Platform fallback credentials will be managed here.",
    admin: true,
  },
];

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [pathname, setPathname] = useState(() =>
    normalizedPath(window.location.pathname),
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void api<{ user: User }>("/api/v1/auth/me")
      .then((result) => setUser(result.user))
      .catch(() => setUser(null));
    if (window.location.pathname === "/")
      window.history.replaceState({}, "", "/create");
    const onPopState = () =>
      setPathname(normalizedPath(window.location.pathname));
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
    [pathname],
  );
  const navigation = routes.filter(
    (route) =>
      route.path !== "/settings/account" &&
      (!route.admin || user?.role === "admin"),
  );
  function navigate(event: MouseEvent<HTMLAnchorElement>, path: string) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    window.history.pushState({}, "", path);
    setPathname(path);
    setNavigationOpen(false);
  }

  if (user === undefined)
    return (
      <main className="auth-layout">
        <p>Loading workspace…</p>
      </main>
    );
  if (user === null)
    return (
      <AuthScreen
        onAuthenticated={(authenticated) => {
          if (pathname === "/login") {
            window.history.replaceState({}, "", "/create");
            setPathname("/create");
          }
          setUser(authenticated);
        }}
      />
    );
  const forbidden = activeRoute?.admin && user.role !== "admin";
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
      <aside
        id="primary-navigation"
        className="sidebar"
        data-open={navigationOpen ? "true" : "false"}
      >
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <div className="brand-copy">
            <strong>StoryVideoGen</strong>
            <span>Podcast studio</span>
          </div>
        </div>
        <nav aria-label="Primary navigation">
          {navigation.map((route) => (
            <a
              key={route.path}
              href={route.path}
              aria-label={route.label}
              aria-current={route.path === pathname ? "page" : undefined}
              title={route.label}
              onClick={(event) => navigate(event, route.path)}
            >
              <span className="nav-glyph" aria-hidden="true">
                {route.icon}
              </span>
              <span className="nav-label">{route.label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="avatar" aria-hidden="true">
            {user.username[0]?.toUpperCase()}
          </span>
          <div className="sidebar-footer-copy">
            <strong>{user.username}</strong>
            <a
              href="/settings/account"
              onClick={(event) => navigate(event, "/settings/account")}
            >
              Account
            </a>
          </div>
        </div>
      </aside>
      {navigationOpen ? (
        <button
          className="scrim"
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavigationOpen(false)}
        />
      ) : null}
      <main className="main-content">
        {forbidden ? (
          <AccessDenied />
        ) : activeRoute ? (
          <RoutePage route={activeRoute} onSignedOut={() => setUser(null)} />
        ) : (
          <NotFoundPage navigate={navigate} />
        )}
      </main>
    </div>
  );
}

function AuthScreen({
  onAuthenticated,
}: {
  onAuthenticated: (user: User) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ user: User }>(`/api/v1/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({
          username: data.get("username"),
          password: data.get("password"),
        }),
      });
      onAuthenticated(result.user);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="auth-heading">
        <div className="brand auth-brand">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <div className="brand-copy">
            <strong>StoryVideoGen</strong>
            <span>Podcast studio</span>
          </div>
        </div>
        <p className="eyebrow">Private workspace</p>
        <h1 id="auth-heading">
          {mode === "login" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="page-description">
          Build long-form visual podcast stories with an auditable,
          scene-by-scene workflow.
        </p>
        <form onSubmit={submit}>
          <label>
            Username
            <input
              name="username"
              autoComplete="username"
              required
              minLength={3}
              maxLength={40}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              required
              minLength={8}
            />
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary-button" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>
        <button
          className="text-button"
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login"
            ? "Need an account? Register"
            : "Already registered? Sign in"}
        </button>
      </section>
    </main>
  );
}

function RoutePage({
  route,
  onSignedOut,
}: {
  route: RouteDefinition;
  onSignedOut: () => void;
}) {
  return (
    <section className="page" aria-labelledby="page-heading">
      <header className="page-header">
        <div>
          <p className="eyebrow">{route.eyebrow}</p>
          <h1 id="page-heading">{route.heading}</h1>
          <p className="page-description">{route.description}</p>
        </div>
        <span className="status-chip">Secure workspace</span>
      </header>
      {route.path === "/create" ? (
        <CreateWorkspace />
      ) : route.path === "/library" ? (
        <StoryLibrary />
      ) : route.path === "/subscription" ? (
        <SubscriptionPage />
      ) : route.path === "/settings/providers" ? (
        <ProviderSettings />
      ) : route.path === "/settings/account" ? (
        <AccountSettings onSignedOut={onSignedOut} />
      ) : route.path === "/admin/users" ? (
        <AdminUsers />
      ) : route.path === "/admin/stories" ? (
        <AdminStories />
      ) : route.path === "/admin/providers" ? (
        <AdminProviders />
      ) : (
        <PlaceholderPage />
      )}
    </section>
  );
}

function CreateWorkspace() {
  const [story, setStory] = useState<Story | null>(null);
  const [name, setName] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [saveState, setSaveState] = useState("Not saved");
  const [conflict, setConflict] = useState(false);
  const [assets, setAssets] = useState<PublicAsset[]>([]);
  const [candidates, setCandidates] = useState<ImageCandidate[]>([]);
  const [imageProvider, setImageProvider] = useState("zhipu");
  const [chunkSeconds, setChunkSeconds] = useState(30);
  const [musicVolume, setMusicVolume] = useState(0.18);
  const [voice, setVoice] = useState("zh-CN-XiaoxiaoNeural");
  const [job, setJob] = useState<Job | null>(null);
  const [automation, setAutomation] = useState<AutomationStatus | null>(null);
  useEffect(() => {
    const storyId = new URLSearchParams(window.location.search).get("story");
    if (!storyId) return;
    void reloadStory(storyId)
      .then(() => refreshAutomation(storyId))
      .catch((error) => setSaveState(messageOf(error)));
  }, []);
  useEffect(() => {
    if (
      !story ||
      conflict ||
      (name.trim() === story.name && sourceText.trim() === story.sourceText)
    )
      return;
    setSaveState("Saving…");
    const timer = window.setTimeout(() => {
      void api<{ story: Story }>(`/api/v1/stories/${story.id}`, {
        method: "PATCH",
        body: JSON.stringify({ version: story.version, name, sourceText }),
      })
        .then(({ story: saved }) => {
          setStory(saved);
          setSaveState("Saved");
        })
        .catch((error) => {
          const message = messageOf(error);
          setSaveState(message);
          if (/another session/i.test(message)) setConflict(true);
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [name, sourceText, story, conflict]);
  useEffect(() => {
    if (!job || !["queued", "running", "cancel_requested"].includes(job.state))
      return;
    const timer = window.setInterval(() => {
      void api<{ job: Job }>(`/api/v1/jobs/${job.id}`).then((result) =>
        setJob(result.job),
      );
    }, 350);
    return () => window.clearInterval(timer);
  }, [job]);
  useEffect(() => {
    if (
      job?.state === "succeeded" &&
      story &&
      (!automation || automation.state === "idle")
    )
      void reloadStory(story.id);
  }, [job?.state, automation?.state]);
  useEffect(() => {
    if (!story || automation?.state !== "active") return;
    const timer = window.setInterval(() => {
      void refreshAutomation(story.id);
    }, 500);
    return () => window.clearInterval(timer);
  }, [story?.id, automation?.state]);
  useEffect(() => {
    if (automation?.state === "completed" && story?.status !== "completed")
      void reloadStory(story!.id);
  }, [automation?.state, story?.status]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveState("Saving…");
    try {
      const result = await api<{ story: Story }>("/api/v1/stories", {
        method: "POST",
        body: JSON.stringify({ name, sourceText }),
      });
      setStory(result.story);
      setName(result.story.name);
      setSourceText(result.story.sourceText);
      setSaveState("Saved");
      window.history.replaceState({}, "", `/create?story=${result.story.id}`);
    } catch (error) {
      setSaveState(messageOf(error));
    }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!story) return;
    const form = event.currentTarget;
    const body = new FormData(form);
    try {
      const result = await api<{ asset: PublicAsset }>(
        `/api/v1/stories/${story.id}/assets/images`,
        { method: "POST", body },
      );
      setAssets((current) => [...current, result.asset]);
      form.reset();
    } catch (error) {
      setSaveState(messageOf(error));
    }
  }
  async function startPlan() {
    if (!story) return;
    try {
      const result = await api<{ job: Job }>(
        `/api/v1/stories/${story.id}/actions/plan`,
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ chunkSeconds }),
        },
      );
      setJob(result.job);
    } catch (error) {
      setSaveState(messageOf(error));
    }
  }
  async function startAuto() {
    if (!story) return;
    try {
      const result = await api<{ job: Job }>(
        `/api/v1/stories/${story.id}/actions/auto`,
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            imageProvider,
            candidateCount: 2,
            voice,
            chunkSeconds,
          }),
        },
      );
      setJob(result.job);
      setAutomation({
        state: "active",
        storyStatus: "planning",
        errorCode: null,
        errorMessage: null,
        currentJob: result.job,
        jobCount: 1,
      });
      setSaveState("Auto mode queued. You can leave this page.");
    } catch (error) {
      setSaveState(messageOf(error));
    }
  }
  async function startImages(scene: Scene, prompt: Prompt) {
    try {
      const result = await api<{ job: Job }>(
        `/api/v1/scenes/${scene.id}/actions/images`,
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            promptId: prompt.id,
            provider: imageProvider,
            count: 2,
          }),
        },
      );
      setJob(result.job);
    } catch (error) {
      setSaveState(messageOf(error));
    }
  }
  async function selectCandidate(candidate: ImageCandidate) {
    if (!story) return;
    try {
      await api(`/api/v1/image-candidates/${candidate.id}/select`, {
        method: "POST",
      });
      await reloadStory(story.id);
    } catch (error) {
      setSaveState(messageOf(error));
    }
  }
  async function uploadSceneImage(
    event: FormEvent<HTMLFormElement>,
    scene: Scene,
  ) {
    event.preventDefault();
    if (!story) return;
    const form = event.currentTarget;
    try {
      await api(`/api/v1/scenes/${scene.id}/assets/images`, {
        method: "POST",
        body: new FormData(form),
      });
      form.reset();
      await reloadStory(story.id);
    } catch (error) {
      setSaveState(messageOf(error));
    }
  }
  async function uploadMusic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!story) return;
    const form = event.currentTarget;
    try {
      await api(`/api/v1/stories/${story.id}/assets/music`, {
        method: "POST",
        body: new FormData(form),
      });
      form.reset();
      await reloadStory(story.id);
    } catch (error) {
      setSaveState(messageOf(error));
    }
  }
  async function startRender() {
    if (!story) return;
    const music = [...assets].reverse().find((asset) => asset.kind === "music");
    try {
      const result = await api<{ job: Job }>(
        `/api/v1/stories/${story.id}/actions/render`,
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ musicAssetId: music?.id, musicVolume, voice }),
        },
      );
      setJob(result.job);
    } catch (error) {
      setSaveState(messageOf(error));
    }
  }
  async function cancelJob() {
    if (!job) return;
    const result = await api<{ job: Job }>(`/api/v1/jobs/${job.id}/cancel`, {
      method: "POST",
    });
    setJob(result.job);
  }
  async function cancelAutomation() {
    if (!story) return;
    try {
      const result = await api<AutomationStatus>(
        `/api/v1/stories/${story.id}/automation/cancel`,
        { method: "POST" },
      );
      setAutomation(result);
      setJob(result.currentJob);
      setSaveState("Auto mode cancelled.");
      await reloadStory(story.id);
    } catch (error) {
      setSaveState(messageOf(error));
    }
  }
  async function refreshAutomation(storyId: string) {
    const result = await api<AutomationStatus>(
      `/api/v1/stories/${storyId}/automation`,
    );
    setAutomation(result);
    setJob(result.currentJob);
    if (result.state === "active")
      setSaveState(
        `Auto mode: ${result.storyStatus.replaceAll("_", " ")}. Safe to leave this page.`,
      );
    else if (result.state === "completed")
      setSaveState("Auto podcast completed.");
    else if (result.state === "failed")
      setSaveState(
        result.errorMessage || "Auto mode stopped. Review the failed story.",
      );
  }
  async function reloadStory(id: string) {
    const [result, images, media] = await Promise.all([
      api<{ story: Story }>(`/api/v1/stories/${id}`),
      api<{ candidates: ImageCandidate[] }>(
        `/api/v1/stories/${id}/image-candidates`,
      ),
      api<{ assets: PublicAsset[] }>(`/api/v1/stories/${id}/assets`),
    ]);
    setStory(result.story);
    setName(result.story.name);
    setSourceText(result.story.sourceText);
    setCandidates(images.candidates);
    setAssets(media.assets);
    setSaveState("Saved");
  }
  async function updateScene(scene: Scene, narrationText: string) {
    if (!story) return;
    try {
      await api(`/api/v1/scenes/${scene.id}`, {
        method: "PATCH",
        body: JSON.stringify({ version: scene.version, narrationText }),
      });
      await reloadStory(story.id);
    } catch (error) {
      setSaveState(messageOf(error));
    }
  }
  async function splitScene(scene: Scene) {
    if (!story) return;
    const offset = Math.floor(scene.sourceText.length / 2);
    try {
      await api(`/api/v1/scenes/${scene.id}/split`, {
        method: "POST",
        body: JSON.stringify({ version: scene.version, offset }),
      });
      await reloadStory(story.id);
    } catch (error) {
      setSaveState(messageOf(error));
    }
  }
  async function mergeScene(scene: Scene) {
    if (!story) return;
    try {
      await api(`/api/v1/scenes/${scene.id}/merge-next`, {
        method: "POST",
        body: JSON.stringify({ version: scene.version }),
      });
      await reloadStory(story.id);
    } catch (error) {
      setSaveState(messageOf(error));
    }
  }
  async function updatePrompt(prompt: Prompt, promptText: string) {
    if (!story || promptText.trim() === prompt.promptText) return;
    try {
      await api(`/api/v1/prompts/${prompt.id}`, {
        method: "PATCH",
        body: JSON.stringify({ version: prompt.version, promptText }),
      });
      await reloadStory(story.id);
    } catch (error) {
      setSaveState(messageOf(error));
    }
  }
  const scenes = story?.scenes ?? [];
  return (
    <div className="settings-stack">
      <div className="story-editor-grid">
        <form
          className="surface story-form"
          onSubmit={(event) => void create(event)}
        >
          <div className="editor-status">
            <span>
              {story
                ? `${story.status.replaceAll("_", " ")} · ${story.wordCount.toLocaleString()} words`
                : "New draft"}
            </span>
            <strong role="status">{saveState}</strong>
          </div>
          <label>
            Story name
            <input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={160}
              required
              disabled={Boolean(story && story.status !== "draft")}
            />
          </label>
          <label>
            Full story
            <textarea
              name="sourceText"
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              rows={18}
              required
              placeholder="Paste the complete, unabridged story here…"
              disabled={Boolean(story && story.status !== "draft")}
            />
          </label>
          {conflict ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => window.location.reload()}
            >
              Reload latest version
            </button>
          ) : null}
          {!story ? (
            <button className="primary-button">Save draft</button>
          ) : story.status === "draft" ? (
            <>
              <div className="candidate-actions">
                <label>
                  Target scene length (seconds)
                  <input
                    type="number"
                    min={15}
                    max={120}
                    step={5}
                    value={chunkSeconds}
                    onChange={(event) =>
                      setChunkSeconds(Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  Auto image source
                  <select
                    value={imageProvider}
                    onChange={(event) => setImageProvider(event.target.value)}
                  >
                    <option value="zhipu">Zhipu generation</option>
                    <option value="baidu">Baidu search</option>
                    <option value="siliconflow">SiliconFlow generation</option>
                    <option value="pixabay">Pixabay search</option>
                    <option value="openverse">Openverse search</option>
                    <option value="wikimedia">Wikimedia search</option>
                  </select>
                </label>
                <label>
                  Auto narration voice
                  <select
                    value={voice}
                    onChange={(event) => setVoice(event.target.value)}
                  >
                    <option value="zh-CN-XiaoxiaoNeural">
                      Xiaoxiao · female
                    </option>
                    <option value="zh-CN-YunxiNeural">Yunxi · male</option>
                    <option value="zh-CN-XiaoyiNeural">Xiaoyi · female</option>
                  </select>
                </label>
              </div>
              <p>
                Scenes target about {chunkSeconds} seconds each. Auto mode
                selects the first usable image per scene, burns subtitles into
                the video, and continues in the background.
              </p>
              <div className="candidate-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void startAuto()}
                  disabled={automation?.state === "active"}
                >
                  Auto-create podcast
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void startPlan()}
                  disabled={automation?.state === "active"}
                >
                  Plan full story
                </button>
              </div>
            </>
          ) : null}
          {story &&
          story.status !== "draft" &&
          story.status !== "completed" &&
          automation?.state !== "active" ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => void startRender()}
              disabled={Boolean(
                job &&
                  ["queued", "running", "cancel_requested"].includes(job.state),
              )}
            >
              Render podcast video
            </button>
          ) : null}
          {job ? (
            <div className="job-progress" aria-label="Generation progress">
              <div>
                <strong>{job.state.replaceAll("_", " ")}</strong>
                <span>{Math.round(job.progress / 100)}%</span>
              </div>
              <progress value={job.progress} max={10000} />
              {job.errorMessage ? (
                <p className="form-error">{job.errorMessage}</p>
              ) : null}
              {["queued", "running"].includes(job.state) ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    void (automation?.state === "active"
                      ? cancelAutomation()
                      : cancelJob())
                  }
                >
                  {automation?.state === "active"
                    ? "Cancel auto mode"
                    : "Cancel job"}
                </button>
              ) : null}
            </div>
          ) : null}
        </form>
        <aside className="surface story-side-panel">
          <h2>Story assets</h2>
          <p>
            Upload reference images now or generate candidates after scene
            planning.
          </p>
          {story ? (
            <form onSubmit={(event) => void upload(event)}>
              <label>
                Manual image
                <input
                  name="image"
                  type="file"
                  accept="image/png,image/jpeg,image/gif"
                  required
                />
              </label>
              <button className="secondary-button">Upload image</button>
            </form>
          ) : (
            <p>Save the draft before adding assets.</p>
          )}
          {story && story.status !== "draft" ? (
            <>
              <label>
                Narration voice
                <select
                  value={voice}
                  onChange={(event) => setVoice(event.target.value)}
                >
                  <option value="zh-CN-XiaoxiaoNeural">
                    Xiaoxiao · female
                  </option>
                  <option value="zh-CN-YunxiNeural">Yunxi · male</option>
                  <option value="zh-CN-XiaoyiNeural">Xiaoyi · female</option>
                </select>
              </label>
              <form onSubmit={(event) => void uploadMusic(event)}>
                <label>
                  Background music
                  <input
                    name="music"
                    type="file"
                    accept="audio/mpeg,audio/wav"
                    required
                  />
                </label>
                <label className="inline-choice">
                  <input
                    name="rightsAttested"
                    type="checkbox"
                    value="true"
                    required
                  />
                  I have permission to use this music
                </label>
                <label>
                  Music volume
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={musicVolume}
                    onChange={(event) =>
                      setMusicVolume(Number(event.target.value))
                    }
                  />
                </label>
                <button className="secondary-button">Upload music</button>
              </form>
            </>
          ) : null}
          {assets
            .filter((asset) => !asset.sceneId)
            .map((asset) => (
              <a
                key={asset.id}
                href={
                  asset.kind === "image" || asset.kind === "video"
                    ? asset.url
                    : asset.downloadUrl
                }
                target="_blank"
                rel="noreferrer"
              >
                {asset.kind === "image"
                  ? `Image ${asset.width}×${asset.height}`
                  : asset.kind === "video"
                    ? "Play finished video"
                    : `Download ${asset.kind}`}
              </a>
            ))}
        </aside>
      </div>
      {scenes.length ? (
        <section
          className="scene-review"
          aria-labelledby="scene-review-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Complete-source plan</p>
              <h2 id="scene-review-heading">Review {scenes.length} scenes</h2>
            </div>
            <span className="configured-badge">100% source coverage</span>
          </div>
          {scenes.map((scene, index) => {
            const sceneCandidates = candidates.filter(
              (candidate) => candidate.sceneId === scene.id,
            );
            return (
              <article className="surface scene-card" key={scene.id}>
                <header>
                  <strong>Scene {index + 1}</strong>
                  <div>
                    <button
                      className="secondary-button"
                      onClick={() => void splitScene(scene)}
                    >
                      Split
                    </button>
                    {index < scenes.length - 1 ? (
                      <button
                        className="secondary-button"
                        onClick={() => void mergeScene(scene)}
                      >
                        Merge next
                      </button>
                    ) : null}
                  </div>
                </header>
                <details>
                  <summary>Source text</summary>
                  <p>{scene.sourceText}</p>
                </details>
                <label>
                  Narration
                  <textarea
                    defaultValue={scene.narrationText}
                    rows={5}
                    onBlur={(event) =>
                      void updateScene(scene, event.target.value)
                    }
                  />
                </label>
                <div className="prompt-stack">
                  <strong>Image descriptions</strong>
                  {scene.prompts.map((prompt, promptIndex) => (
                    <label key={prompt.id}>
                      Prompt {promptIndex + 1}
                      <textarea
                        defaultValue={prompt.promptText}
                        rows={3}
                        onBlur={(event) =>
                          void updatePrompt(prompt, event.target.value)
                        }
                      />
                    </label>
                  ))}
                  {scene.prompts[0] ? (
                    <div className="candidate-actions">
                      <label>
                        Image source
                        <select
                          value={imageProvider}
                          onChange={(event) =>
                            setImageProvider(event.target.value)
                          }
                        >
                          <option value="zhipu">Zhipu generation</option>
                          <option value="baidu">Baidu search</option>
                          <option value="siliconflow">
                            SiliconFlow generation
                          </option>
                          <option value="pixabay">Pixabay search</option>
                          <option value="openverse">Openverse search</option>
                          <option value="wikimedia">Wikimedia search</option>
                        </select>
                      </label>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() =>
                          void startImages(scene, scene.prompts[0]!)
                        }
                        disabled={Boolean(
                          job &&
                            ["queued", "running", "cancel_requested"].includes(
                              job.state,
                            ),
                        )}
                      >
                        Generate 2 images with {providerLabel(imageProvider)}
                      </button>
                    </div>
                  ) : null}
                </div>
                <form
                  className="inline-upload"
                  onSubmit={(event) => void uploadSceneImage(event, scene)}
                >
                  <label>
                    Upload an image for this scene
                    <input
                      name="image"
                      type="file"
                      accept="image/png,image/jpeg,image/gif"
                      required
                    />
                  </label>
                  <button className="secondary-button">Add candidate</button>
                </form>
                {sceneCandidates.length ? (
                  <div
                    className="candidate-grid"
                    aria-label={`Scene ${index + 1} image candidates`}
                  >
                    {sceneCandidates.map((candidate) => (
                      <article
                        className={`candidate-card${candidate.isSelected ? " selected" : ""}`}
                        key={candidate.id}
                      >
                        {candidate.asset ? (
                          <img
                            src={candidate.asset.url}
                            alt={`Scene ${index + 1} ${candidate.provider} candidate`}
                          />
                        ) : (
                          <div className="candidate-placeholder">
                            {candidate.status}
                          </div>
                        )}
                        <div>
                          <strong>{candidate.provider}</strong>
                          <span>{candidate.model ?? "uploaded"}</span>
                        </div>
                        {candidate.status === "ready" ? (
                          <button
                            className={
                              candidate.isSelected
                                ? "primary-button"
                                : "secondary-button"
                            }
                            type="button"
                            onClick={() => void selectCandidate(candidate)}
                          >
                            {candidate.isSelected ? "Selected" : "Choose image"}
                          </button>
                        ) : candidate.errorMessage ? (
                          <p className="form-error">{candidate.errorMessage}</p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

function StoryLibrary() {
  const [result, setResult] = useState<StoryList>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    pageCount: 0,
  });
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const load = (page = 1) => {
    const query = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (status) query.set("status", status);
    if (search.trim()) query.set("search", search.trim());
    return api<StoryList>(`/api/v1/stories?${query}`)
      .then(setResult)
      .catch((caught) => setError(messageOf(caught)));
  };
  useEffect(() => {
    void load();
  }, []);
  async function archive(story: Story) {
    try {
      await api(`/api/v1/stories/${story.id}/archive`, {
        method: "POST",
        body: JSON.stringify({ version: story.version }),
      });
      await load(result.page);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }
  return (
    <div className="settings-stack">
      <form
        className="library-controls"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label>
          Search
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Story name"
          />
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="planning">Planning</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <button className="secondary-button">Apply filters</button>
      </form>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {result.items.length === 0 ? (
        <div className="surface empty-state">
          <h2>No stories found</h2>
          <p>Start a draft in Create, or adjust these filters.</p>
        </div>
      ) : (
        <div className="library-list">
          {result.items.map((story) => (
            <article className="surface library-item" key={story.id}>
              <div>
                <span className={`story-status status-${story.status}`}>
                  {story.status.replaceAll("_", " ")}
                </span>
                <h2>{story.name}</h2>
                <p>
                  {story.wordCount.toLocaleString()} words · Updated{" "}
                  {new Date(story.updatedAt).toLocaleString()}
                </p>
              </div>
              <div className="library-actions">
                <a
                  className="secondary-button"
                  href={`/create?story=${story.id}`}
                >
                  Open
                </a>
                {story.status !== "archived" ? (
                  <button
                    className="danger-button"
                    onClick={() => void archive(story)}
                  >
                    Archive
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="pagination">
        <button
          className="secondary-button"
          disabled={result.page <= 1}
          onClick={() => void load(result.page - 1)}
        >
          Previous
        </button>
        <span>
          Page {result.page} of {Math.max(result.pageCount, 1)}
        </span>
        <button
          className="secondary-button"
          disabled={result.page >= result.pageCount}
          onClick={() => void load(result.page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function SubscriptionPage() {
  type Billing = {
    subscription: null | {
      displayName: string;
      periodEnd: string;
      quotas: Record<string, number>;
      usage: Record<string, number>;
    };
    plans: Array<{
      code: string;
      displayName: string;
      priceFen: number;
      periodDays: number;
      quotas: Record<string, number>;
    }>;
    orders: Array<{
      id: string;
      planCode: string;
      amountFen: number;
      state: string;
      codeUrl: string;
    }>;
    paymentMode: string;
  };
  const [billing, setBilling] = useState<Billing | null>(null);
  const [message, setMessage] = useState("");
  const load = () => api<Billing>("/api/v1/billing").then(setBilling);
  useEffect(() => {
    void load().catch((error) => setMessage(messageOf(error)));
  }, []);
  async function buy(planCode: string) {
    try {
      await api("/api/v1/billing/orders", {
        method: "POST",
        body: JSON.stringify({ planCode }),
      });
      await load();
    } catch (error) {
      setMessage(messageOf(error));
    }
  }
  async function finish(orderId: string, outcome: "paid" | "failed") {
    try {
      await api(`/api/v1/billing/orders/${orderId}/fake-complete`, {
        method: "POST",
        body: JSON.stringify({ outcome }),
      });
      await load();
    } catch (error) {
      setMessage(messageOf(error));
    }
  }
  if (!billing) return <p>{message || "Loading subscription…"}</p>;
  return (
    <div className="settings-stack">
      {billing.subscription ? (
        <article className="surface">
          <p className="eyebrow">Current plan</p>
          <h2>{billing.subscription.displayName}</h2>
          <p>
            Active through{" "}
            {new Date(billing.subscription.periodEnd).toLocaleDateString()}
          </p>
          <div className="usage-grid">
            {Object.entries(billing.subscription.quotas).map(
              ([unit, quota]) => (
                <div key={unit}>
                  <strong>
                    {billing.subscription?.usage[unit] ?? 0} / {quota}
                  </strong>
                  <span>{unit.replaceAll("_", " ")}</span>
                </div>
              ),
            )}
          </div>
        </article>
      ) : (
        <p className="form-error">
          Your plan has expired. Existing drafts and downloads remain available.
        </p>
      )}
      <div className="plan-grid">
        {billing.plans
          .filter((plan) => plan.priceFen > 0)
          .map((plan) => (
            <article className="surface" key={plan.code}>
              <h2>{plan.displayName}</h2>
              <strong>¥{(plan.priceFen / 100).toFixed(2)}</strong>
              <p>{plan.periodDays} prepaid days</p>
              <button
                className="primary-button"
                disabled={billing.paymentMode === "disabled"}
                onClick={() => void buy(plan.code)}
              >
                {billing.paymentMode === "disabled"
                  ? "WeChat Pay unavailable"
                  : "Pay with WeChat"}
              </button>
            </article>
          ))}
      </div>
      {billing.orders.length ? (
        <section>
          <h2>Order history</h2>
          {billing.orders.map((order) => (
            <article className="provider-card" key={order.id}>
              <div>
                <strong>
                  {order.planCode} · ¥{(order.amountFen / 100).toFixed(2)}
                </strong>
                <p>{order.state}</p>
                {order.state === "pending" ? (
                  <code>{order.codeUrl}</code>
                ) : null}
              </div>
              {order.state === "pending" && billing.paymentMode === "fake" ? (
                <div>
                  <button
                    className="primary-button"
                    onClick={() => void finish(order.id, "paid")}
                  >
                    Simulate paid
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void finish(order.id, "failed")}
                  >
                    Simulate failed
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}

function ProviderSettings() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [message, setMessage] = useState("");
  const load = () =>
    api<{ providers: ProviderStatus[] }>("/api/v1/settings/providers").then(
      (result) => setProviders(result.providers),
    );
  useEffect(() => {
    void load().catch((error) => setMessage(messageOf(error)));
  }, []);
  async function save(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    setMessage("");
    const form = event.currentTarget;
    const key = String(new FormData(form).get("apiKey") || "");
    try {
      await api(`/api/v1/settings/providers/${id}`, {
        method: "PUT",
        body: JSON.stringify({ apiKey: key }),
      });
      form.reset();
      await load();
      setMessage("Provider key saved securely.");
    } catch (error) {
      setMessage(messageOf(error));
    }
  }
  async function testProvider(id: string) {
    try {
      await api(`/api/v1/settings/providers/${id}/test`, { method: "POST" });
      await load();
      setMessage("Provider capabilities verified.");
    } catch (error) {
      setMessage(messageOf(error));
    }
  }
  async function remove(id: string) {
    try {
      await api(`/api/v1/settings/providers/${id}`, { method: "DELETE" });
      await load();
      setMessage("Provider key removed.");
    } catch (error) {
      setMessage(messageOf(error));
    }
  }
  return (
    <div className="settings-stack">
      {message ? (
        <p className="form-message" role="status">
          {message}
        </p>
      ) : null}
      <article className="provider-card">
        <div>
          <h2>Baidu Images</h2>
          <p>
            Built-in image search remains available without adding another
            search integration.
          </p>
        </div>
        <span className="configured-badge">Built in</span>
      </article>
      {providers.map((provider) => (
        <article className="provider-card" key={provider.id}>
          <div className="provider-copy">
            <h2>{provider.label}</h2>
            <p>
              {capabilities(provider)} ·{" "}
              {provider.configured
                ? `Saved key ending ${provider.lastFour}`
                : "No personal key saved"}
            </p>
            <small>
              Text: {provider.textTestStatus} · Image/search:{" "}
              {provider.imageTestStatus}
            </small>
          </div>
          <form
            className="provider-form"
            onSubmit={(event) => void save(event, provider.id)}
          >
            <label>
              <span className="sr-only">{provider.label} API key</span>
              <input
                name="apiKey"
                type="password"
                autoComplete="off"
                placeholder={
                  provider.configured ? "Replace saved key" : "Enter API key"
                }
                required
              />
            </label>
            <button className="primary-button">Save</button>
            {provider.configured ? (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void testProvider(provider.id)}
                >
                  Test
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => void remove(provider.id)}
                >
                  Remove
                </button>
              </>
            ) : null}
          </form>
        </article>
      ))}
    </div>
  );
}

function AccountSettings({ onSignedOut }: { onSignedOut: () => void }) {
  const [message, setMessage] = useState("");
  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await api("/api/v1/auth/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: data.get("currentPassword"),
          newPassword: data.get("newPassword"),
        }),
      });
      onSignedOut();
    } catch (error) {
      setMessage(messageOf(error));
    }
  }
  async function logout() {
    try {
      await api("/api/v1/auth/logout", { method: "POST" });
    } finally {
      onSignedOut();
    }
  }
  return (
    <div className="settings-stack">
      <article className="surface account-panel">
        <h2>Change password</h2>
        <form onSubmit={(event) => void change(event)}>
          <label>
            Current password
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            New password
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          {message ? (
            <p role="alert" className="form-error">
              {message}
            </p>
          ) : null}
          <button className="primary-button">Change password</button>
        </form>
      </article>
      <article className="surface account-panel">
        <h2>Current session</h2>
        <p>Sign out on this browser.</p>
        <button className="secondary-button" onClick={() => void logout()}>
          Sign out
        </button>
      </article>
    </div>
  );
}

function AdminUsers() {
  const [users, setUsers] = useState<
    Array<{
      id: string;
      username: string;
      role: string;
      status: string;
      storyCount: number;
    }>
  >([]);
  const [error, setError] = useState("");
  const load = () =>
    api<{ users: typeof users }>("/api/v1/admin/user-list").then((result) =>
      setUsers(result.users),
    );
  useEffect(() => {
    void load().catch((caught) => setError(messageOf(caught)));
  }, []);
  async function status(id: string, value: string) {
    try {
      await api(`/api/v1/admin/users/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: value }),
      });
      await load();
    } catch (error) {
      setError(messageOf(error));
    }
  }
  if (error)
    return (
      <p role="alert" className="form-error">
        {error}
      </p>
    );
  return (
    <div className="surface">
      <table>
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>Stories</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {users.map((item) => (
            <tr key={item.id}>
              <td>{item.username}</td>
              <td>{item.role}</td>
              <td>{item.storyCount}</td>
              <td>
                <select
                  aria-label={`${item.username} status`}
                  value={item.status}
                  onChange={(event) => void status(item.id, event.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminStories() {
  const [stories, setStories] = useState<
    Array<{
      id: string;
      name: string;
      username: string;
      status: string;
      wordCount: number;
    }>
  >([]);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void api<{ stories: typeof stories }>("/api/v1/admin/stories")
      .then((result) => setStories(result.stories))
      .catch((caught) => setError(messageOf(caught)));
  }, []);
  async function support(id: string) {
    const reason = window.prompt("Support reason (required and audited)");
    if (!reason) return;
    try {
      const result = await api<{ story: { sourceText: string } }>(
        `/api/v1/admin/stories/${id}/support-content`,
        { method: "POST", body: JSON.stringify({ reason }) },
      );
      setContent(result.story.sourceText);
    } catch (caught) {
      setError(messageOf(caught));
    }
  }
  return (
    <div className="settings-stack">
      {error ? <p className="form-error">{error}</p> : null}
      <div className="surface">
        <table>
          <thead>
            <tr>
              <th>Story</th>
              <th>User</th>
              <th>Status</th>
              <th>Words</th>
              <th>Support</th>
            </tr>
          </thead>
          <tbody>
            {stories.map((story) => (
              <tr key={story.id}>
                <td>{story.name}</td>
                <td>{story.username}</td>
                <td>{story.status}</td>
                <td>{story.wordCount}</td>
                <td>
                  <button
                    className="secondary-button"
                    onClick={() => void support(story.id)}
                  >
                    View content
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {content ? (
        <article className="surface">
          <h2>Audited support view</h2>
          <p>{content}</p>
        </article>
      ) : null}
    </div>
  );
}
function AdminProviders() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [message, setMessage] = useState("");
  const load = () =>
    api<{ providers: ProviderStatus[] }>("/api/v1/admin/providers").then(
      (result) => setProviders(result.providers),
    );
  useEffect(() => {
    void load();
  }, []);
  async function save(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api(`/api/v1/admin/providers/${id}`, {
        method: "PUT",
        body: JSON.stringify({ apiKey: new FormData(form).get("apiKey") }),
      });
      form.reset();
      await load();
      setMessage("Platform key rotated securely.");
    } catch (error) {
      setMessage(messageOf(error));
    }
  }
  async function disable(id: string) {
    await api(`/api/v1/admin/providers/${id}/disable`, { method: "POST" });
    await load();
  }
  return (
    <div className="settings-stack">
      {message ? <p role="status">{message}</p> : null}
      {providers.map((provider) => (
        <article className="provider-card" key={provider.id}>
          <div>
            <h2>{provider.label}</h2>
            <p>
              {provider.configured
                ? `Configured ending ${provider.lastFour}`
                : "No platform fallback"}
            </p>
          </div>
          <form
            className="provider-form"
            onSubmit={(event) => void save(event, provider.id)}
          >
            <label>
              <span className="sr-only">{provider.label} platform API key</span>
              <input name="apiKey" type="password" required />
            </label>
            <button className="primary-button">Rotate key</button>
            {provider.configured && provider.status === "active" ? (
              <button
                type="button"
                className="danger-button"
                onClick={() => void disable(provider.id)}
              >
                Disable
              </button>
            ) : null}
          </form>
        </article>
      ))}
    </div>
  );
}

function PlaceholderPage() {
  return (
    <div className="placeholder-grid">
      <article className="surface surface-primary">
        <p className="eyebrow">Current milestone</p>
        <h2>Secure application foundation</h2>
        <p>
          This workspace is ready for its persistent workflow service in the
          next implementation slice.
        </p>
        <div className="progress-track">
          <span />
        </div>
      </article>
      <article className="surface">
        <p className="eyebrow">Runtime</p>
        <dl className="fact-list">
          <div>
            <dt>Web</dt>
            <dd>Node + React</dd>
          </div>
          <div>
            <dt>Media</dt>
            <dd>Private Python worker</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>SQLite + local disk</dd>
          </div>
        </dl>
      </article>
    </div>
  );
}
function AccessDenied() {
  return (
    <section className="page not-found">
      <p className="eyebrow">403</p>
      <h1>Access denied</h1>
      <p className="page-description">Administrator permission is required.</p>
    </section>
  );
}
function NotFoundPage({
  navigate,
}: {
  navigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void;
}) {
  return (
    <section className="page not-found">
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <p className="page-description">
        The address is not part of the StoryVideoGen workspace.
      </p>
      <a
        className="primary-link"
        href="/create"
        onClick={(event) => navigate(event, "/create")}
      >
        Return to Create
      </a>
    </section>
  );
}

async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (typeof options.body === "string")
    headers.set("content-type", "application/json");
  const csrf = cookieValue("storyvideogen_csrf");
  if (csrf && options.method && !["GET", "HEAD"].includes(options.method))
    headers.set("x-csrf-token", csrf);
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(
      payload?.error?.message || "The request could not be completed.",
    );
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}
function cookieValue(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
function normalizedPath(pathname: string): string {
  if (pathname === "/") return "/create";
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}
function capabilities(provider: ProviderStatus): string {
  return [
    provider.capabilities.text && "Text",
    provider.capabilities.image && "Images",
    provider.capabilities.search && "Search",
  ]
    .filter(Boolean)
    .join(" + ");
}
function providerLabel(provider: string): string {
  return (
    (
      {
        zhipu: "Zhipu",
        siliconflow: "SiliconFlow",
        baidu: "Baidu",
        pixabay: "Pixabay",
        openverse: "Openverse",
        wikimedia: "Wikimedia",
      } as Record<string, string>
    )[provider] ?? provider
  );
}
