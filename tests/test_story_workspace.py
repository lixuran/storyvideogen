from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from storyvideogen.story_workspace import (
    create_story_session,
    list_stories,
    load_story_payload,
    normalize_tag,
    write_story_session,
)


class StoryWorkspaceTest(unittest.TestCase):
    def test_normalize_tag_makes_safe_folder_name(self) -> None:
        self.assertEqual(normalize_tag(" SCP 173: Test/Run "), "SCP-173-Test-Run")
        self.assertEqual(normalize_tag(""), "story")

    def test_create_and_list_story_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)

            story = create_story_session(workspace, "scp-173", title="SCP 173", story_text="A statue waits.")
            stories = list_stories(workspace)

            self.assertEqual(story["tag"], "scp-173")
            self.assertEqual(story["status"], "draft")
            self.assertEqual(len(stories), 1)
            self.assertEqual(stories[0]["title"], "SCP 173")
            self.assertEqual(stories[0]["story_text"], "A statue waits.")

    def test_list_stories_overlays_active_job_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            story = create_story_session(workspace, "running")

            stories = list_stories(
                workspace,
                [
                    {
                        "job_id": "job-1",
                        "output_dir": story["output_dir"],
                        "status": "running",
                        "message": "Generating image candidates...",
                    }
                ],
            )

            self.assertEqual(stories[0]["status"], "preparing")
            self.assertEqual(stories[0]["job_id"], "job-1")
            self.assertEqual(stories[0]["message"], "Generating image candidates...")

    def test_load_story_payload_reads_persisted_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            story = create_story_session(workspace, "loaded")
            output_dir = Path(str(story["output_dir"]))
            project = {
                "story": {"title": "Loaded", "text": "Story text."},
                "settings": {"target_seconds": 90},
                "chunks": [],
            }
            (output_dir / "interactive_project.json").write_text('{"story":{"title":"Loaded","text":"Story text."},"settings":{"target_seconds":90},"chunks":[]}', encoding="utf-8")
            write_story_session(output_dir, status="prepared", message="Ready.")

            payload = load_story_payload(output_dir)

            self.assertEqual(payload["story"]["status"], "prepared")
            self.assertEqual(payload["story"]["title"], "Loaded")
            self.assertEqual(payload["project"], project)


if __name__ == "__main__":
    unittest.main()
