## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Default local-model settings live in [.env](.env):
   `STORYBOARD_PROVIDER=ollama`
   `OLLAMA_BASE_URL=http://127.0.0.1:11434`
   `OLLAMA_MODEL=qwen3.5:9b`
3. Set the `GEMINI_API_KEY` in `.env.local` if you want Gemini storyboarding or Gemini image/video generation
4. Run the app:
   `npm run dev`

## Storyboard Providers

- `gemini`: Sends the uploaded audio directly to Gemini for storyboard generation.
- `ollama`: Uses your local Ollama server for storyboard generation. The current local `qwen3.5:9b` model exposed by Ollama in this environment supports `completion`, `vision`, `tools`, and `thinking`, so the app sends browser-derived audio analysis context to Ollama rather than raw audio bytes.

The UI settings panel lets you override:

- storyboard provider
- Ollama base URL
- Ollama model
- Gemini API key
