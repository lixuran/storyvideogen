import io
import json
import tempfile
import tomllib
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from storyvideogen.worker_cli import load_request, main


class WorkerContractTest(unittest.TestCase):
    def test_edge_tts_is_a_required_worker_dependency(self) -> None:
        project = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))
        dependencies = project["project"]["dependencies"]
        self.assertTrue(any(value.startswith("edge-tts>=") for value in dependencies))

    def test_fixture_worker_emits_versioned_ordered_ndjson(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            request_path = root / "request.json"
            request_path.write_text(json.dumps({
                "contractVersion": 1,
                "jobId": "job-1",
                "storyId": "story-1",
                "operation": "plan_story",
                "storageRoot": str(root),
                "input": {"fixture": "success"},
                "settings": {},
                "credentialEnvironment": [],
            }), encoding="utf-8")
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(main(["plan_story", "--request", str(request_path)]), 0)
            events = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual([event["sequence"] for event in events], [1, 2, 3])
            self.assertTrue(all(event["contractVersion"] == 1 and event["jobId"] == "job-1" for event in events))
            self.assertEqual(events[-1]["type"], "completed")

    def test_request_must_match_operation_and_assigned_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            request_path = root / "request.json"
            request_path.write_text(json.dumps({"contractVersion": 1, "jobId": "job-1", "operation": "render_video", "storageRoot": str(root), "input": {}, "settings": {}}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "envelope"):
                load_request(request_path, "plan_story")

    def test_fixture_image_worker_writes_bounded_candidate_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            request_path = root / "request.json"
            request_path.write_text(json.dumps({
                "contractVersion": 1,
                "jobId": "job-images",
                "storyId": "story-1",
                "operation": "generate_images",
                "storageRoot": str(root),
                "input": {"fixture": "success", "provider": "fixture", "model": "fixture-image", "prompt": "A lighthouse in moonlight", "candidateIds": ["candidate-1", "candidate-2"]},
                "settings": {},
            }), encoding="utf-8")
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(main(["generate_images", "--request", str(request_path)]), 0)
            result = json.loads((root / "images.json").read_text(encoding="utf-8"))
            self.assertEqual([candidate["candidateId"] for candidate in result["candidates"]], ["candidate-1", "candidate-2"])
            self.assertTrue(all(candidate["status"] == "ready" and (root / candidate["file"]).is_file() for candidate in result["candidates"]))
            events = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual(events[-1]["payload"]["resultFile"], "images.json")


if __name__ == "__main__":
    unittest.main()
