import "./styles.css";

const app = document.querySelector("#app");

app.innerHTML = `
  <main class="app-shell">
    <header class="hero">
      <h1>StoryVideoGen</h1>
      <p class="lede">Cozy-creepy narrated story videos with Chinese subtitles, generated imagery, manual image picks, and server-side project history.</p>
    </header>

    <section id="auth-panel" class="auth-grid">
      <form id="login-form" class="panel">
        <h2>Login</h2>
        <label>Username <input name="username" autocomplete="username" required></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit">Login</button>
        <div id="login-status" class="status"></div>
      </form>
      <form id="register-form" class="panel">
        <h2>Register</h2>
        <label>Username <input name="username" autocomplete="username" required></label>
        <label>Password <input name="password" type="password" autocomplete="new-password" required></label>
        <button type="submit">Create Account</button>
        <div id="register-status" class="status"></div>
      </form>
    </section>

    <section id="app-panel" class="hidden">
      <div class="user-bar panel">
        <div>
          <strong id="current-user">Not logged in</strong>
          <div id="current-workspace" class="hint"></div>
        </div>
        <button type="button" id="logout" class="secondary">Logout</button>
      </div>

      <section class="workspace">
        <aside class="sidebar">
          <section class="panel">
            <h2>Workspace</h2>
            <label>Workspace <input id="workspace" value="" readonly></label>
            <nav class="tab-nav" aria-label="Workflow tabs">
              <button type="button" class="tab-button active" data-tab="stories">Stories</button>
              <button type="button" class="tab-button" data-tab="project">Project</button>
              <button type="button" class="tab-button" data-tab="images">Images</button>
              <button type="button" class="tab-button" data-tab="audio">Audio</button>
              <button type="button" class="tab-button" data-tab="account">Account</button>
            </nav>
          </section>

          <section class="panel">
            <h2>Current Story</h2>
            <div id="current-story-summary" class="hint">Create or select a story.</div>
            <div class="actions">
              <button type="button" id="prepare">Prepare Images</button>
              <button type="button" id="compose" class="secondary" disabled>Compose Video</button>
            </div>
            <div id="status" class="status"></div>
          </section>
        </aside>

        <section class="content-stack">
          <section class="panel tab-panel active" data-panel="stories">
            <h2>Stories</h2>
            <label>New story tag <input id="new-story-tag" placeholder="scp-173-test"></label>
            <div class="actions">
              <button type="button" id="create-story">Create New Story</button>
              <button type="button" id="refresh-stories" class="secondary">Refresh</button>
            </div>
            <div id="story-list-status" class="status"></div>
            <div id="story-list" class="story-list">Loading stories...</div>
          </section>

          <section class="panel tab-panel" data-panel="project">
            <form id="settings">
              <h2>Project</h2>
              <label>English title <input name="title" value="Story Title"></label>
              <label>Target output directory <input name="output_dir" value="" readonly></label>
              <div class="hint">Managed automatically from the selected story. Create or select a story before preparing images.</div>
              <label>Story text <textarea name="story_text" placeholder="Paste the story here..."></textarea></label>
              <div class="actions">
                <button type="button" id="save-draft">Save Draft</button>
              </div>
              <div id="draft-status" class="status"></div>

              <h2>Generation</h2>
              <div class="row">
                <label>Target seconds <input name="target_seconds" type="number" value="90"></label>
                <label>Seconds per image chunk <input name="chunk_seconds" type="number" min="5" max="120" value="30"></label>
              </div>
              <div class="hint">Higher chunk seconds means fewer, longer visual sections. Example: 120s video at 30s per chunk gives about 4 chunks.</div>
              <div class="row">
                <label>Candidates per chunk <input name="candidates_per_chunk" type="number" min="1" max="6" value="2"></label>
                <label>Image workers <input name="image_workers" type="number" min="1" max="16" value="1"></label>
              </div>
              <div class="hint">For Zhipu, keep image workers at 1 to avoid HTTP 429 rate limits. Increase only if your quota allows it.</div>
              <div class="row">
                <label>Width <input name="width" type="number" value="1920"></label>
                <label>Height <input name="height" type="number" value="1080"></label>
              </div>

              <h2>Providers</h2>
              <div class="row">
                <label>Translator
                  <select name="translator">
                    <option value="zai" selected>zai</option>
                    <option value="google">google</option>
                    <option value="mock">mock</option>
                    <option value="identity">identity</option>
                  </select>
                </label>
                <label>Translation model <input name="translation_model" value="glm-5.2"></label>
              </div>
              <div class="row">
                <label>Prompt provider
                  <select name="prompt_provider">
                    <option value="zai" selected>zai</option>
                    <option value="heuristic">heuristic</option>
                  </select>
                </label>
                <label>Prompt model <input name="prompt_model" value="glm-5.2"></label>
              </div>
              <div class="row">
                <label>Image provider
                  <select name="image_provider">
                    <option value="zhipu" selected>zhipu</option>
                    <option value="siliconflow">siliconflow</option>
                    <option value="baidu">baidu</option>
                    <option value="pexels">pexels</option>
                    <option value="pixabay">pixabay</option>
                    <option value="openverse">openverse</option>
                    <option value="wikimedia">wikimedia</option>
                    <option value="fixture">fixture</option>
                  </select>
                </label>
                <label>Image model <input name="image_model" value="cogview-3-flash"></label>
              </div>
              <div class="row">
                <label>TTS provider
                  <select name="tts_provider">
                    <option value="edge" selected>edge</option>
                    <option value="silent">silent</option>
                  </select>
                </label>
                <label>Chinese voice <input name="voice" value="zh-CN-XiaoxiaoNeural"></label>
              </div>

              <h2>Attribution</h2>
              <label>Author <input name="author"></label>
              <label>Source URL <input name="source_url"></label>
              <label>Story license <input name="story_license" value="CC BY-SA 3.0"></label>
            </form>
          </section>

          <section class="panel tab-panel" data-panel="images">
            <h2>Image Choices</h2>
            <div id="chunks">Create or select a story to begin.</div>
          </section>

          <section class="panel tab-panel" data-panel="audio">
            <h2>Background Music</h2>
            <form id="audio-settings">
              <label>Music file path <input name="background_music" placeholder="D:/music/ambient.mp3"></label>
              <label>Music volume <input name="music_volume" type="number" min="0" max="1" step="0.01" value="0.18"></label>
            </form>
            <div id="downloads"></div>
          </section>

          <section class="panel tab-panel" data-panel="account">
            <h2>API Settings</h2>
            <form id="api-settings-form">
              <label>ZAI API key <input name="zai_api_key" type="password" autocomplete="off" placeholder="Leave blank to keep current key"></label>
              <label><span class="inline-choice"><input name="clear_zai_api_key" type="checkbox"> Clear saved ZAI key</span></label>
              <label>Zhipu image API key <input name="zhipu_image_api_key" type="password" autocomplete="off" placeholder="Optional; ZAI key is also accepted"></label>
              <label><span class="inline-choice"><input name="clear_zhipu_image_api_key" type="checkbox"> Clear saved Zhipu image key</span></label>
              <label>SiliconFlow API key <input name="siliconflow_api_key" type="password" autocomplete="off" placeholder="Optional"></label>
              <label><span class="inline-choice"><input name="clear_siliconflow_api_key" type="checkbox"> Clear saved SiliconFlow key</span></label>
              <label>Pexels API key <input name="pexels_api_key" type="password" autocomplete="off" placeholder="Optional"></label>
              <label><span class="inline-choice"><input name="clear_pexels_api_key" type="checkbox"> Clear saved Pexels key</span></label>
              <label>Pixabay API key <input name="pixabay_api_key" type="password" autocomplete="off" placeholder="Optional"></label>
              <label><span class="inline-choice"><input name="clear_pixabay_api_key" type="checkbox"> Clear saved Pixabay key</span></label>
              <div id="api-key-status" class="hint">API keys not loaded.</div>
              <button type="submit">Save API Settings</button>
            </form>

            <h2>Change Password</h2>
            <form id="password-settings-form">
              <label>Current password <input name="current_password" type="password" autocomplete="current-password"></label>
              <label>New password <input name="new_password" type="password" autocomplete="new-password"></label>
              <button type="submit" class="secondary">Change Password</button>
              <div id="password-status" class="status"></div>
            </form>
          </section>
        </section>
      </section>
    </section>
  </main>
`;

const authPanel = document.querySelector("#auth-panel");
const appPanel = document.querySelector("#app-panel");
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const loginStatusEl = document.querySelector("#login-status");
const registerStatusEl = document.querySelector("#register-status");
const currentUserEl = document.querySelector("#current-user");
const currentWorkspaceEl = document.querySelector("#current-workspace");
const currentStorySummaryEl = document.querySelector("#current-story-summary");
const logoutButton = document.querySelector("#logout");
const form = document.querySelector("#settings");
const audioForm = document.querySelector("#audio-settings");
const workspaceInput = document.querySelector("#workspace");
const newStoryTagInput = document.querySelector("#new-story-tag");
const createStoryButton = document.querySelector("#create-story");
const refreshStoriesButton = document.querySelector("#refresh-stories");
const saveDraftButton = document.querySelector("#save-draft");
const storyListStatusEl = document.querySelector("#story-list-status");
const draftStatusEl = document.querySelector("#draft-status");
const storyListEl = document.querySelector("#story-list");
const apiSettingsForm = document.querySelector("#api-settings-form");
const passwordSettingsForm = document.querySelector("#password-settings-form");
const apiKeyStatusEl = document.querySelector("#api-key-status");
const passwordStatusEl = document.querySelector("#password-status");
const statusEl = document.querySelector("#status");
const chunksEl = document.querySelector("#chunks");
const downloadsEl = document.querySelector("#downloads");
const prepareButton = document.querySelector("#prepare");
const composeButton = document.querySelector("#compose");

window.manualSelections = {};
window.canCompose = false;
window.currentStory = null;
window.currentProject = null;
window.stories = [];
window.activeWatchers = {};
window.activeComposeWatchers = {};
window.csrfToken = "";
window.editorBusy = false;

function formPayload() {
  return {...formObject(form), ...formObject(audioForm)};
}

function workspaceValue() {
  return workspaceInput.value.trim() || "output/ui_stories";
}

function requireSelectedStory() {
  if (!window.currentStory || !window.currentStory.output_dir) {
    throw new Error("Create or select a story first.");
  }
  setField("output_dir", window.currentStory.output_dir);
  return window.currentStory.output_dir;
}

function payloadForCurrentStory() {
  const payload = formPayload();
  payload.output_dir = requireSelectedStory();
  return payload;
}

function authPayload(authForm) {
  return formObject(authForm);
}

function formObject(targetForm) {
  const data = new FormData(targetForm);
  const payload = Object.fromEntries(data.entries());
  for (const checkbox of targetForm.querySelectorAll('input[type="checkbox"]')) {
    payload[checkbox.name] = checkbox.checked;
  }
  return payload;
}

function switchTab(tabName) {
  for (const button of document.querySelectorAll(".tab-button")) {
    button.classList.toggle("active", button.dataset.tab === tabName);
  }
  for (const panel of document.querySelectorAll(".tab-panel")) {
    panel.classList.toggle("active", panel.dataset.panel === tabName);
  }
}

function showAuth() {
  authPanel.classList.remove("hidden");
  appPanel.classList.add("hidden");
  currentUserEl.textContent = "Not logged in";
  currentWorkspaceEl.textContent = "";
}

async function showApp(user, workspace) {
  authPanel.classList.add("hidden");
  appPanel.classList.remove("hidden");
  currentUserEl.textContent = `Logged in as ${user.username}`;
  currentWorkspaceEl.textContent = workspace;
  workspaceInput.value = workspace;
  setField("output_dir", "");
  await loadStories();
  await loadAccountSettings();
}

function setField(name, value) {
  const field = form.elements[name] || audioForm.elements[name];
  if (field) {
    field.value = value ?? "";
  }
}

function setEditorStatus(message) {
  statusEl.textContent = message || "";
  updateEditorControls();
}

function updateEditorControls() {
  const isPreparing = window.currentStory && window.currentStory.status === "preparing";
  prepareButton.disabled = window.editorBusy || isPreparing || !window.currentStory;
  composeButton.disabled = window.editorBusy || isPreparing || !window.currentStory || !window.currentProject || !window.canCompose;
  currentStorySummaryEl.textContent = window.currentStory
    ? `${window.currentStory.title || window.currentStory.tag} | ${window.currentStory.status || "draft"}`
    : "Create or select a story.";
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json", "X-CSRF-Token": window.csrfToken || ""},
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (response.status === 401) {
    showAuth();
    throw new Error("Login required.");
  }
  if (!response.ok || data.error) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (response.status === 401) {
    showAuth();
    throw new Error("Login required.");
  }
  if (!response.ok || data.error) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

async function loadStories() {
  const result = await getJson(`/api/stories?workspace=${encodeURIComponent(workspaceValue())}`);
  window.stories = result.stories || [];
  renderStoryList(window.stories);
  for (const story of window.stories) {
    if (story.status === "preparing" && story.job_id) {
      watchPrepareJob(story.job_id, story.output_dir);
    } else if ((story.status === "queued" || story.status === "composing") && story.job_id) {
      watchComposeJob(story.job_id, story.output_dir);
    }
  }
  return window.stories;
}

async function loadCurrentUser() {
  const session = await getJson("/api/me");
  if (session.user) {
    window.csrfToken = session.csrf_token || "";
    await showApp(session.user, session.workspace);
  } else {
    showAuth();
  }
}

async function loadAccountSettings() {
  const settings = await getJson("/api/account");
  renderAccountSettings(settings);
  return settings;
}

function renderAccountSettings(settings) {
  const apiKeys = (settings && settings.api_keys) || {};
  const labels = [
    `ZAI: ${apiKeys.zai ? "configured" : "missing"}`,
    `Zhipu image: ${apiKeys.zhipu_image ? "configured" : "missing"}`,
    `SiliconFlow: ${apiKeys.siliconflow ? "configured" : "missing"}`,
    `Pexels: ${apiKeys.pexels ? "configured" : "missing"}`,
    `Pixabay: ${apiKeys.pixabay ? "configured" : "missing"}`
  ];
  apiKeyStatusEl.textContent = labels.join(" | ");
}

function renderStoryList(stories) {
  storyListEl.innerHTML = "";
  if (!stories.length) {
    storyListEl.textContent = "No stories yet. Create a tag to start.";
    return;
  }
  for (const story of stories) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "story-item";
    if (window.currentStory && story.output_dir === window.currentStory.output_dir) {
      item.classList.add("active");
    }

    const title = document.createElement("strong");
    title.textContent = story.title || story.tag;
    item.appendChild(title);

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = story.status || "draft";
    item.appendChild(badge);

    const message = document.createElement("span");
    message.textContent = story.message || story.output_dir;
    item.appendChild(message);

    const output = document.createElement("span");
    output.textContent = story.output_dir;
    item.appendChild(output);

    item.addEventListener("click", () => loadStory(story.output_dir));
    storyListEl.appendChild(item);
  }
}

async function createStory() {
  const tag = newStoryTagInput.value.trim() || `story-${Date.now()}`;
  storyListStatusEl.textContent = "Creating story...";
  const result = await postJson("/api/stories", {
    workspace: workspaceValue(),
    tag
  });
  newStoryTagInput.value = "";
  window.stories = result.stories || [];
  renderStoryList(window.stories);
  await loadStory(result.story.output_dir);
  storyListStatusEl.textContent = `Created ${result.story.tag}.`;
  switchTab("project");
}

async function loadStory(outputDir) {
  const result = await getJson(`/api/story?output_dir=${encodeURIComponent(outputDir)}`);
  window.currentStory = result.story;
  window.currentProject = result.project || null;
  window.canCompose = false;
  window.manualSelections = {};
  populateForm(result.story, result.project);
  if (result.project) {
    const canCompose = ["prepared", "composed"].includes(result.story.status);
    renderProject(result.project, canCompose);
  } else {
    chunksEl.textContent = "Prepare this story to see image candidates.";
    window.canCompose = false;
    renderDownloadLinks();
  }
  setEditorStatus(result.story.message || `Loaded ${result.story.tag}.`);
  renderStoryList(window.stories);
  if (result.story.status === "preparing" && result.story.job_id) {
    watchPrepareJob(result.story.job_id, result.story.output_dir);
  } else if ((result.story.status === "queued" || result.story.status === "composing") && result.story.job_id) {
    watchComposeJob(result.story.job_id, result.story.output_dir);
  }
}

function populateForm(story, project) {
  const settings = (project && project.settings) || story.settings || {};
  setField("title", story.title || story.tag || "Story Title");
  setField("output_dir", story.output_dir || "");
  setField("story_text", story.story_text || "");
  for (const name of [
    "target_seconds",
    "chunk_seconds",
    "candidates_per_chunk",
    "image_workers",
    "width",
    "height",
    "translator",
    "translation_model",
    "prompt_provider",
    "prompt_model",
    "image_provider",
    "image_model",
    "tts_provider",
    "voice"
  ]) {
    if (settings[name] !== undefined) {
      setField(name, settings[name]);
    }
  }
}

function renderProject(project, canCompose = false) {
  window.currentProject = project;
  window.canCompose = canCompose;
  chunksEl.innerHTML = "";
  for (const chunk of project.chunks) {
    const section = document.createElement("section");
    section.className = "chunk";

    const heading = document.createElement("h3");
    heading.textContent = `Chunk ${chunk.index}`;
    section.appendChild(heading);

    const source = document.createElement("p");
    source.textContent = chunk.text;
    section.appendChild(source);

    const subtitle = document.createElement("p");
    subtitle.textContent = chunk.subtitle_text;
    section.appendChild(subtitle);

    const chunkActions = document.createElement("div");
    chunkActions.className = "chunk-actions";
    const manualButton = document.createElement("button");
    manualButton.type = "button";
    manualButton.textContent = "Upload Image From This Laptop";
    manualButton.addEventListener("click", () => chooseLocalImage(chunk.index));
    chunkActions.appendChild(manualButton);
    section.appendChild(chunkActions);

    const cards = document.createElement("div");
    cards.className = "cards";
    const preferredSelection = String(window.manualSelections[chunk.index] || "");
    for (const candidate of chunk.image_candidates) {
      const card = document.createElement("label");
      card.className = "candidate";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `chunk-${chunk.index}`;
      radio.value = candidate.candidate_index;
      radio.disabled = !candidate.asset;
      if (candidate.asset && preferredSelection && preferredSelection === String(candidate.candidate_index)) {
        radio.checked = true;
      } else if (candidate.asset && !preferredSelection && !cards.querySelector("input:checked")) {
        radio.checked = true;
      }
      card.appendChild(radio);

      if (candidate.asset) {
        const image = document.createElement("img");
        image.src = `/api/asset?path=${encodeURIComponent(candidate.asset.local_path)}`;
        image.alt = candidate.prompt;
        card.appendChild(image);
      } else {
        const error = document.createElement("div");
        error.className = "error";
        error.textContent = candidate.error === "pending" ? "Generating image..." : (candidate.error || "Image generation failed.");
        card.appendChild(error);
      }

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = candidate.prompt;
      card.appendChild(meta);
      if (candidate.asset && candidate.asset.source_url) {
        const source = document.createElement("a");
        source.href = candidate.asset.source_url;
        source.target = "_blank";
        source.rel = "noreferrer";
        source.textContent = candidate.asset.provider === "pexels"
          ? `Photo by ${candidate.asset.creator || "a Pexels photographer"} on Pexels`
          : "View image source";
        card.appendChild(source);
      }
      cards.appendChild(card);
    }
    section.appendChild(cards);
    chunksEl.appendChild(section);
  }
  updateEditorControls();
  renderDownloadLinks();
}

function renderDownloadLinks() {
  downloadsEl.innerHTML = "";
  if (!window.currentStory || !window.currentStory.video_path) {
    downloadsEl.textContent = "Downloads appear here after compose.";
    return;
  }
  downloadsEl.className = "actions";
  const video = document.createElement("a");
  video.href = `/api/download?path=${encodeURIComponent(window.currentStory.video_path)}`;
  video.textContent = "Download Video";
  video.className = "download-link";
  downloadsEl.appendChild(video);
  const srtPath = `${window.currentStory.output_dir}/subtitles.zh-CN.srt`;
  const subtitles = document.createElement("a");
  subtitles.href = `/api/download?path=${encodeURIComponent(srtPath)}`;
  subtitles.textContent = "Download SRT";
  subtitles.className = "download-link";
  downloadsEl.appendChild(subtitles);
}

async function chooseLocalImage(chunkIndex) {
  if (!window.currentProject) {
    statusEl.textContent = "Prepare a project before choosing local images.";
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", async () => {
    if (!input.files || !input.files[0]) {
      return;
    }
    try {
      statusEl.textContent = `Uploading local image for chunk ${chunkIndex}...`;
      const data = new FormData();
      data.append("output_dir", requireSelectedStory());
      data.append("chunk_index", String(chunkIndex));
      data.append("image", input.files[0]);
      const response = await fetch("/api/manual-image", {
        method: "POST",
        headers: {"X-CSRF-Token": window.csrfToken || ""},
        body: data
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        throw new Error(result.error || `Upload failed: ${response.status}`);
      }
      window.manualSelections[chunkIndex] = result.candidate.candidate_index;
      renderProject(result.project, window.canCompose);
      statusEl.textContent = `Local image selected for chunk ${chunkIndex}.`;
      await loadStories();
    } catch (error) {
      statusEl.textContent = error.message;
    }
  });
  input.click();
}

function selectedCandidates() {
  const selections = {};
  if (!window.currentProject) {
    return selections;
  }
  for (const chunk of window.currentProject.chunks) {
    const selected = document.querySelector(`input[name="chunk-${chunk.index}"]:checked`);
    if (selected) {
      selections[String(chunk.index)] = selected.value;
    }
  }
  return selections;
}

async function saveDraft() {
  const payload = payloadForCurrentStory();
  draftStatusEl.textContent = "Saving draft...";
  const result = await postJson("/api/story/draft", payload);
  window.currentStory = result.story;
  draftStatusEl.textContent = "Draft saved.";
  setEditorStatus(result.story.message || "Draft saved.");
  await loadStories();
}

prepareButton.addEventListener("click", async () => {
  try {
    const payload = payloadForCurrentStory();
    window.currentProject = null;
    window.canCompose = false;
    if (window.currentStory) {
      window.currentStory.status = "preparing";
      window.currentStory.message = "Preparing story, translating, generating detailed Chinese prompts, and starting image generation...";
    }
    setEditorStatus("Preparing story, translating, generating detailed Chinese prompts, and starting image generation...");
    chunksEl.textContent = "Waiting for prompt plan...";
    switchTab("images");
    const job = await postJson("/api/prepare", payload);
    if (window.currentStory) {
      window.currentStory.job_id = job.job_id;
    }
    watchPrepareJob(job.job_id, payload.output_dir);
    await loadStories();
  } catch (error) {
    if (window.currentStory) {
      window.currentStory.status = "failed";
    }
    setEditorStatus(error.message);
  }
});

function watchPrepareJob(jobId, outputDir) {
  if (!jobId || window.activeWatchers[jobId]) {
    return;
  }
  window.activeWatchers[jobId] = true;
  pollPrepareJob(jobId, outputDir);
}

async function pollPrepareJob(jobId, outputDir) {
  try {
    const job = await getJson(`/api/job?job_id=${encodeURIComponent(jobId)}`);
    const isCurrent = window.currentStory && window.currentStory.output_dir === outputDir;
    if (job.project && isCurrent) {
      renderProject(job.project, job.status === "complete");
    }
    if (isCurrent) {
      window.currentStory.status = job.status === "running" ? "preparing" : job.status === "complete" ? "prepared" : "failed";
      window.currentStory.message = job.message || "";
      statusEl.textContent = job.error || job.message || "Generating image candidates...";
      updateEditorControls();
    }

    if (job.status === "complete") {
      delete window.activeWatchers[jobId];
      await loadStories();
      if (isCurrent) {
        await loadStory(outputDir);
        statusEl.textContent = `Prepared ${job.project.chunks.length} chunks. Pick one image per chunk, then compose.`;
      }
      return;
    }
    if (job.status === "failed") {
      delete window.activeWatchers[jobId];
      await loadStories();
      if (isCurrent) {
        statusEl.textContent = job.error || "Prepare failed.";
        updateEditorControls();
      }
      return;
    }
    setTimeout(() => pollPrepareJob(jobId, outputDir), 1200);
  } catch (error) {
    delete window.activeWatchers[jobId];
    if (window.currentStory && window.currentStory.output_dir === outputDir) {
      statusEl.textContent = error.message;
      updateEditorControls();
    }
  }
}

function watchComposeJob(jobId, outputDir) {
  if (!jobId || window.activeComposeWatchers[jobId]) {
    return;
  }
  window.activeComposeWatchers[jobId] = true;
  pollComposeJob(jobId, outputDir);
}

async function pollComposeJob(jobId, outputDir) {
  try {
    const job = await getJson(`/api/compose-job?job_id=${encodeURIComponent(jobId)}`);
    const isCurrent = window.currentStory && window.currentStory.output_dir === outputDir;
    if (isCurrent) {
      window.currentStory.status = job.status === "running" ? "composing" : job.status;
      window.currentStory.message = job.message || "";
      statusEl.textContent = job.error || job.message || "Composing final video...";
      updateEditorControls();
    }
    if (job.status === "complete") {
      delete window.activeComposeWatchers[jobId];
      await loadStories();
      if (isCurrent) {
        await loadStory(outputDir);
        statusEl.textContent = `Video complete:\n${job.result.video_path || job.result.run_plan}`;
      }
      return;
    }
    if (job.status === "failed") {
      delete window.activeComposeWatchers[jobId];
      await loadStories();
      if (isCurrent) {
        statusEl.textContent = job.error || "Compose failed.";
        updateEditorControls();
      }
      return;
    }
    setTimeout(() => pollComposeJob(jobId, outputDir), 1200);
  } catch (error) {
    delete window.activeComposeWatchers[jobId];
    if (window.currentStory && window.currentStory.output_dir === outputDir) {
      statusEl.textContent = error.message;
      updateEditorControls();
    }
  }
}

composeButton.addEventListener("click", async () => {
  try {
    const payload = payloadForCurrentStory();
    payload.selections = selectedCandidates();
    if (window.currentStory) {
      window.currentStory.status = "queued";
    }
    setEditorStatus("Queueing compose job...");
    switchTab("audio");
    const result = await postJson("/api/compose", payload);
    if (window.currentStory) {
      window.currentStory.job_id = result.job_id;
    }
    watchComposeJob(result.job_id, payload.output_dir);
    await loadStories();
  } catch (error) {
    setEditorStatus(error.message);
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    loginStatusEl.textContent = "Logging in...";
    const result = await postJson("/api/login", authPayload(loginForm));
    window.csrfToken = result.csrf_token || "";
    loginForm.reset();
    loginStatusEl.textContent = "";
    await showApp(result.user, result.workspace);
  } catch (error) {
    loginStatusEl.textContent = error.message;
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    registerStatusEl.textContent = "Creating account...";
    const result = await postJson("/api/register", authPayload(registerForm));
    window.csrfToken = result.csrf_token || "";
    registerForm.reset();
    registerStatusEl.textContent = "";
    await showApp(result.user, result.workspace);
  } catch (error) {
    registerStatusEl.textContent = error.message;
  }
});

apiSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    apiKeyStatusEl.textContent = "Saving API settings...";
    const result = await postJson("/api/account/api-keys", formObject(apiSettingsForm));
    apiSettingsForm.reset();
    renderAccountSettings(result);
  } catch (error) {
    apiKeyStatusEl.textContent = error.message;
  }
});

passwordSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    passwordStatusEl.textContent = "Changing password...";
    await postJson("/api/account/password", formObject(passwordSettingsForm));
    passwordSettingsForm.reset();
    passwordStatusEl.textContent = "Password changed.";
  } catch (error) {
    passwordStatusEl.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await postJson("/api/logout", {});
  } finally {
    window.csrfToken = "";
    window.currentStory = null;
    window.currentProject = null;
    window.stories = [];
    apiKeyStatusEl.textContent = "API keys not loaded.";
    passwordStatusEl.textContent = "";
    storyListEl.textContent = "Login to load stories.";
    chunksEl.textContent = "Create or select a story to begin.";
    renderDownloadLinks();
    showAuth();
  }
});

createStoryButton.addEventListener("click", async () => {
  try {
    await createStory();
  } catch (error) {
    storyListStatusEl.textContent = error.message;
  }
});

refreshStoriesButton.addEventListener("click", async () => {
  try {
    storyListStatusEl.textContent = "Refreshing...";
    await loadStories();
    storyListStatusEl.textContent = "";
  } catch (error) {
    storyListStatusEl.textContent = error.message;
  }
});

saveDraftButton.addEventListener("click", async () => {
  try {
    await saveDraft();
  } catch (error) {
    draftStatusEl.textContent = error.message;
  }
});

for (const button of document.querySelectorAll(".tab-button")) {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
}

async function initialize() {
  try {
    renderDownloadLinks();
    await loadCurrentUser();
    const stories = window.stories;
    if (stories.length) {
      await loadStory(stories[0].output_dir);
    } else {
      updateEditorControls();
    }
  } catch (error) {
    storyListStatusEl.textContent = error.message;
  }
}

initialize();
