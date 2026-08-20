from __future__ import annotations

import unittest
from pathlib import Path

from storyvideogen.interactive_workflow import InteractiveSettings, prepare_interactive_project
WEB_MAIN = (Path(__file__).resolve().parents[1] / "web" / "src" / "main.js").read_text(encoding="utf-8")
WEB_CSS = (Path(__file__).resolve().parents[1] / "web" / "src" / "styles.css").read_text(encoding="utf-8")

from storyvideogen.ui_server import (
    _active_compose_jobs_for_user,
    _active_prepare_jobs_for_user,
    _api_key_updates_from_payload,
    _clear_session_cookie,
    _download_filename,
    _seed_composed_project,
    _seed_prepared_project,
    _path_belongs_to_user,
    _safe_user_output_dir,
    _session_cookie,
    _user_workspace,
)


class UIServerTest(unittest.TestCase):
    def test_ui_exposes_auth_controls(self) -> None:
        self.assertIn('id="login-form"', WEB_MAIN)
        self.assertIn('id="register-form"', WEB_MAIN)
        self.assertIn("/api/login", WEB_MAIN)
        self.assertIn("/api/register", WEB_MAIN)
        self.assertIn("/api/logout", WEB_MAIN)
        self.assertIn("X-CSRF-Token", WEB_MAIN)

    def test_session_cookies_are_http_only(self) -> None:
        self.assertIn("HttpOnly", _session_cookie("token"))
        self.assertIn("SameSite=Lax", _session_cookie("token"))
        self.assertIn("Max-Age=0", _clear_session_cookie())

    def test_download_filename_is_header_safe(self) -> None:
        self.assertEqual(_download_filename('bad"name\r\n.mp4'), "bad_name__.mp4")

    def test_user_output_dir_must_stay_inside_user_workspace(self) -> None:
        user = {"id": 1, "username": "alice"}
        output_dir = _user_workspace(user) / "story-1"

        self.assertEqual(_safe_user_output_dir(user, str(output_dir)), output_dir)

        with self.assertRaises(PermissionError):
            _safe_user_output_dir(user, "output/ui_users/bob/stories/story-1")

    def test_path_and_active_jobs_are_scoped_to_current_user(self) -> None:
        alice = {"id": 1, "username": "alice"}
        bob = {"id": 2, "username": "bob"}
        alice_path = _user_workspace(alice) / "story-1" / "image.jpg"
        bob_path = _user_workspace(bob) / "story-1" / "image.jpg"

        self.assertTrue(_path_belongs_to_user(alice, alice_path))
        self.assertFalse(_path_belongs_to_user(alice, bob_path))

        # Active job storage is global, but list responses must be filtered per user.
        import storyvideogen.ui_server as ui_server

        try:
            ui_server._PREPARE_JOBS.clear()
            ui_server._COMPOSE_JOBS.clear()
            ui_server._PREPARE_JOBS.update(
                {
                    "alice-job": {"job_id": "alice-job", "output_dir": str(alice_path.parent)},
                    "bob-job": {"job_id": "bob-job", "output_dir": str(bob_path.parent)},
                }
            )
            ui_server._COMPOSE_JOBS.update(
                {
                    "alice-compose": {"job_id": "alice-compose", "output_dir": str(alice_path.parent)},
                    "bob-compose": {"job_id": "bob-compose", "output_dir": str(bob_path.parent)},
                }
            )

            prepare_jobs = _active_prepare_jobs_for_user(alice)
            compose_jobs = _active_compose_jobs_for_user(alice)

            self.assertEqual([job["job_id"] for job in prepare_jobs], ["alice-job"])
            self.assertEqual([job["job_id"] for job in compose_jobs], ["alice-compose"])
        finally:
            ui_server._PREPARE_JOBS.clear()
            ui_server._COMPOSE_JOBS.clear()

    def test_ui_exposes_story_workspace_controls(self) -> None:
        self.assertIn("Create New Story", WEB_MAIN)
        self.assertIn('id="story-list"', WEB_MAIN)
        self.assertIn("/api/stories", WEB_MAIN)
        self.assertIn("/api/story", WEB_MAIN)
        self.assertIn("/api/story/draft", WEB_MAIN)
        self.assertIn("watchPrepareJob", WEB_MAIN)
        self.assertIn("watchComposeJob", WEB_MAIN)

    def test_ui_manages_story_output_directory_from_selected_story(self) -> None:
        self.assertIn('name="output_dir" value="" readonly', WEB_MAIN)
        self.assertNotIn('value="output/ui_stories/story-title"', WEB_MAIN)
        self.assertIn("function payloadForCurrentStory()", WEB_MAIN)
        self.assertIn("payload.output_dir = requireSelectedStory();", WEB_MAIN)
        self.assertIn('data.append("output_dir", requireSelectedStory());', WEB_MAIN)
        self.assertIn("Create or select a story first.", WEB_MAIN)

    def test_ui_exposes_chunk_seconds_control(self) -> None:
        self.assertIn('name="chunk_seconds"', WEB_MAIN)
        self.assertIn("Seconds per image chunk", WEB_MAIN)
        self.assertIn("120s video at 30s per chunk", WEB_MAIN)

    def test_ui_exposes_manual_image_picker(self) -> None:
        self.assertIn("Upload Image From This Laptop", WEB_MAIN)
        self.assertIn("/api/manual-image", WEB_MAIN)
        self.assertIn('input.type = "file"', WEB_MAIN)

    def test_ui_exposes_download_links(self) -> None:
        self.assertIn("/api/download", WEB_MAIN)
        self.assertIn("Download Video", WEB_MAIN)
        self.assertIn("Download SRT", WEB_MAIN)

    def test_ui_exposes_account_settings_controls(self) -> None:
        self.assertIn('id="api-settings-form"', WEB_MAIN)
        self.assertIn('name="zai_api_key"', WEB_MAIN)
        self.assertIn('name="clear_zai_api_key"', WEB_MAIN)
        self.assertIn('id="password-settings-form"', WEB_MAIN)
        self.assertIn("/api/account/api-keys", WEB_MAIN)
        self.assertIn("/api/account/password", WEB_MAIN)

    def test_ui_uses_left_hand_tabs(self) -> None:
        self.assertIn('class="tab-button active" data-tab="stories"', WEB_MAIN)
        self.assertIn('data-tab="project"', WEB_MAIN)
        self.assertIn('data-tab="images"', WEB_MAIN)
        self.assertIn('data-tab="audio"', WEB_MAIN)
        self.assertIn('data-tab="account"', WEB_MAIN)
        self.assertIn(".workspace", WEB_CSS)

    def test_api_key_payload_maps_only_allowed_fields(self) -> None:
        updates, clear_names = _api_key_updates_from_payload(
            {
                "zai_api_key": "zai-secret",
                "pixabay_api_key": "",
                "clear_pixabay_api_key": True,
                "ignored": "secret",
            }
        )

        self.assertEqual(updates, {"ZAI_API_KEY": "zai-secret"})
        self.assertEqual(clear_names, {"PIXABAY_API_KEY"})

    def test_e2e_seed_helpers_write_prepared_and_composed_state(self) -> None:
        import tempfile

        from storyvideogen.story_workspace import load_story_payload

        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "story"

            _seed_prepared_project(output_dir)
            prepared = load_story_payload(output_dir)

            self.assertEqual(prepared["story"]["status"], "prepared")
            self.assertEqual(prepared["project"]["chunks"][0]["image_candidates"][0]["asset"]["provider"], "fixture")

            _seed_composed_project(output_dir)
            composed = load_story_payload(output_dir)

            self.assertEqual(composed["story"]["status"], "composed")
            self.assertTrue(Path(str(composed["story"]["video_path"])).is_file())

    def test_ui_defaults_to_zhipu_image_provider(self) -> None:
        self.assertIn('<option value="zhipu" selected>zhipu</option>', WEB_MAIN)
        self.assertIn('name="image_model" value="glm-image"', WEB_MAIN)
        self.assertIn('name="image_workers" type="number" min="1" max="16" value="1"', WEB_MAIN)
        self.assertIn('name="candidates_per_chunk" type="number" min="1" max="6" value="2"', WEB_MAIN)
        self.assertIn("avoid HTTP 429 rate limits", WEB_MAIN)

    def test_zhipu_prepare_failure_does_not_fallback_to_baidu(self) -> None:
        settings = InteractiveSettings(
            story_text="The concrete statue waited in the locked room.",
            title="No Fallback Test",
            output_dir=Path("output/no_fallback_test"),
            translator="mock",
            prompt_provider="heuristic",
            image_provider="zhipu",
            image_model="glm-image",
            candidates_per_chunk=1,
        )

        project = prepare_interactive_project(settings)
        candidates = project["chunks"][0]["image_candidates"]

        self.assertIn("ZHIPU_IMAGE_API_KEY", candidates[0]["error"])
        self.assertIsNone(candidates[0]["asset"])


if __name__ == "__main__":
    unittest.main()
