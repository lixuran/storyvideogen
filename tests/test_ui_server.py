from __future__ import annotations

import unittest
from pathlib import Path

from storyvideogen.interactive_workflow import InteractiveSettings, prepare_interactive_project
from storyvideogen.ui_server import (
    _HTML,
    _active_prepare_jobs_for_user,
    _path_belongs_to_user,
    _safe_user_output_dir,
    _user_workspace,
)


class UIServerTest(unittest.TestCase):
    def test_ui_exposes_auth_controls(self) -> None:
        self.assertIn('id="login-form"', _HTML)
        self.assertIn('id="register-form"', _HTML)
        self.assertIn("/api/login", _HTML)
        self.assertIn("/api/register", _HTML)
        self.assertIn("/api/logout", _HTML)

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
            ui_server._PREPARE_JOBS.update(
                {
                    "alice-job": {"job_id": "alice-job", "output_dir": str(alice_path.parent)},
                    "bob-job": {"job_id": "bob-job", "output_dir": str(bob_path.parent)},
                }
            )

            jobs = _active_prepare_jobs_for_user(alice)

            self.assertEqual([job["job_id"] for job in jobs], ["alice-job"])
        finally:
            ui_server._PREPARE_JOBS.clear()

    def test_ui_exposes_story_workspace_controls(self) -> None:
        self.assertIn("Create New Story", _HTML)
        self.assertIn('id="story-list"', _HTML)
        self.assertIn("/api/stories", _HTML)
        self.assertIn("/api/story", _HTML)
        self.assertIn("watchPrepareJob", _HTML)

    def test_ui_exposes_chunk_seconds_control(self) -> None:
        self.assertIn('name="chunk_seconds"', _HTML)
        self.assertIn("Seconds per image chunk", _HTML)
        self.assertIn("120s video at 30s per chunk", _HTML)

    def test_ui_exposes_manual_image_picker(self) -> None:
        self.assertIn("Choose Local Image", _HTML)
        self.assertIn("/api/manual-image", _HTML)
        self.assertIn('input.type = "file"', _HTML)

    def test_ui_defaults_to_zhipu_image_provider(self) -> None:
        self.assertIn('<option value="zhipu" selected>zhipu</option>', _HTML)
        self.assertIn('name="image_model" value="glm-image"', _HTML)
        self.assertIn('name="image_workers" type="number" min="1" max="16" value="1"', _HTML)
        self.assertIn('name="candidates_per_chunk" type="number" min="1" max="6" value="2"', _HTML)
        self.assertIn("avoid HTTP 429 rate limits", _HTML)

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
