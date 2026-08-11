# storyvideogen

Local CLI for generating short cozy-creepy story videos from user-provided English stories.

MVP target:
- Simplified Chinese translated narration.
- Simplified Chinese external `.srt` subtitles.
- `1920x1080` 16:9 video.
- Real web images from license-aware sources.
- Narration with optional background music.
- English title card at the beginning.
- Optional looping background music.
- Local UI for choosing one downloaded image candidate per story chunk.

Start the local UI:

```bash
python -m storyvideogen ui
```

Then open `http://127.0.0.1:7860`. The UI lets you paste the story, edit generation settings, prepare multiple image candidates per chunk, select the preferred image, add a background music file path, and compose the final video into the target output directory.

Initial dry run:

```bash
python -m storyvideogen generate --story "samples/short_story.txt" --title "Test Story" --out "output/demo" --translator mock --dry-run
```

Install optional ZAI dependency for prompt planning and meaning-based Chinese translation:

```bash
pip install zai-sdk
```

Offline full render test:

```bash
python -m storyvideogen generate --story "samples/short_story.txt" --title "The Amber Hallway" --out "output/demo" --target-seconds 5 --translator mock --image-provider fixture --tts-provider silent
```

Live MVP path:

```bash
$env:ZAI_API_KEY="your-zai-api-key"
python -m storyvideogen generate --story "input/story.txt" --title "Story Title" --out "output/story_title" --target-seconds 90 --translator zai --translation-model glm-5.2 --image-provider openverse --tts-provider edge --author "Author Name" --source-url "https://example.com/story" --story-license "CC BY-SA 3.0"
```

Faster image path with Pixabay:

```bash
$env:ZAI_API_KEY="your-zai-api-key"
$env:PIXABAY_API_KEY="your-api-key"
python -m storyvideogen generate --story "input/story.txt" --title "Story Title" --out "output/story_title" --target-seconds 90 --translator zai --translation-model glm-5.2 --prompt-provider zai --prompt-model glm-5.2 --image-provider pixabay --image-workers 6 --tts-provider edge
```

China-oriented fast image path without an API key:

```bash
$env:ZAI_API_KEY="your-zai-api-key"
python -m storyvideogen generate --story "input/story.txt" --title "Story Title" --out "output/story_title" --target-seconds 90 --translator zai --translation-model glm-5.2 --image-provider baidu --image-workers 6 --tts-provider edge
```

Outputs:
- `video.mp4`
- `subtitles.zh-CN.srt`
- `narration.zh-CN.txt`
- `credits.txt`
- `license_manifest.json`
- `run_plan.json`
- `image_manifest.json`
- `audio_manifest.json`

Use `--skip-video` to generate text, image, audio, and attribution artifacts without rendering the MP4.

Optional background music for CLI generation:

```bash
python -m storyvideogen generate --story "input/story.txt" --title "Story Title" --out "output/story_title" --background-music "D:/music/ambient.mp3" --music-volume 0.18
```
