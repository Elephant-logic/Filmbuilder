# Filmbuilder / Framecraft — GPT + PiAPI Creative Studio

A responsive, password-protected browser app for creative image/video planning and PiAPI generation.

### What works
- GPT creative-director chat: prompts, shot lists, visual direction, model recommendations.
- Upload JPEG, PNG, WEBP, MP4, MOV, MP3 and WAV references, up to 100 MB each using streaming uploads with progress and a video preview. GPT can see small reference images; uploaded video/audio are NOT fully analysed by GPT.
- Editable production prompt, duration, aspect ratio, resolution, operation, audio toggle.
- PiAPI job submission, task status polling, finished media previews. Uploaded references are hosted automatically when a generation is submitted: files up to 10 MB in supported formats use PiAPI's free 24-hour temporary hosting **if your PiAPI account has Creator/Pro access**, otherwise Filmbuilder provides a signed Render URL valid for up to 6 hours. Each uploaded file has **Get URL → Copy URL** on the production board. Anyone holding the temporary URL can access the file until it expires. Render fallback files are lost when the service restarts or redeploys.
- Seedance 2.5, Seedance 2 Fast, **Kling O1 existing-video character replacement**, Kling Motion Control, Seedream 5 Lite/Pro, Nano Banana 2.1/Pro, Kling 3.0, Veo 3.1 Fast, Wan 2.6, Luma Ray 2, plus custom PiAPI Unified API payloads.

### Replace an entire character while keeping the original scene (Kling O1)
1. On Production board select **Kling O1 · Replace Character in Same Video**. The operation switches to **Edit existing video**.
2. Upload **one 3–10 second MP4/MOV original video** and **1–4 JPG/PNG character references** (each image under 10 MB). Use a clip showing the subject clearly. Uploaded videos are capped at 100 MB by Filmbuilder (provider limit 200 MB).
3. Use `@video` for the source and `@image_1` for the first replacement image in the prompt. The app adds these tags if omitted. Select **720p** and **16:9, 9:16 or 1:1** to match the source. For Kling O1 **base-video edits**, the duration field is disabled and omitted from the PiAPI payload; the edited clip should follow the source clip's length. Source clips must be 3–10 seconds, MP4/MOV, 720–2160 pixels in both dimensions and 24–60 fps. Signed reference URLs support GET and HEAD so media providers can inspect assets before fetching them.
4. Optionally check **Keep original video audio**, then read the displayed price warning and confirm before spending credits. Uses PiAPI `model: kling`, `task_type: omni_video_generation`, `input.version: o1` with `video` and `images`.

Kling O1 generates an edited copy; preserving every background pixel is **not guaranteed**. Pricing shown in PiAPI documentation (720p 5s $0.39 / 10s $0.78) is a base reference and video-editing billing may differ. No live paid PiAPI request has been made for this integration.
- Server-side API keys and private password login. Browser-local chat/job history.

### Deploy on Render
1. Create a **Node** web service using this repository's `main` branch (free plan for testing).
2. **Build command:** `npm test`
3. **Start command:** `npm start`
4. **Region:** Frankfurt for UK use (or choose your preferred region).
5. Add the following environment variables in the **Render dashboard**, not in GitHub:
   - `OPENAI_API_KEY` = your OpenAI API key (from https://platform.openai.com/api-keys)
   - `PIAPI_API_KEY` = your PiAPI API key
   - `APP_PASSWORD` = a long unique private password for your app login
   - `HOST` = `0.0.0.0`
   - `OPENAI_MODEL` = `gpt-4.1-mini` (optional)
   - `DEMO_MODE` = `false`
6. Render sets `PORT` automatically. Once live, open the secure `.onrender.com` URL and sign in with `APP_PASSWORD`.

**Do not deploy publicly with an empty APP_PASSWORD**: the app intentionally blocks use if none is set. Secrets must never go in code or into a public GitHub repository.

### Running locally
Requirements: Node 20+. Add a `.env` file in the repository root (excluded by .gitignore) using the same environment variables; set `HOST=0.0.0.0`, then `npm start` and open `http://localhost:3000`. The login sets a secure cookie and therefore expects HTTPS; use a local HTTPS reverse proxy or temporarily change the cookie's Secure flag only when testing on a trusted machine.

### Known limitations
This is an **MVP**, not a production-tested application. Provider formats are based on public docs but no paid PiAPI generation or OpenAI request has been verified with your keys. Try an inexpensive job for each model first. Model options and prices can change. **Custom mode** accepts a validated JSON envelope, but needs you to supply each model's correct task schema and hosted references. Some models only support a subset of the shared controls, so the API may reject incompatible settings.

Video/audio uploads are available for PiAPI reference workflows, but GPT does not receive a full video analysis. PiAPI's ephemeral file-upload endpoint accepts up to 10 MB and requires a Creator/Pro plan; it deletes hosted files after 24 hours. Filmbuilder tries that first for eligible small files, then falls back to signed, six-hour Render URLs. These are temporary media links, not permanent storage. Individual PiAPI models have their own input video duration, format, resolution and size restrictions; a 100 MB local upload may still be too large for a particular model (e.g. PiAPI FaceSwap is capped at 10 MB and 720p). For Seedance 2.5 edits, supply a 4–30 second MP4/MOV source video. The Render instance must remain reachable long enough for PiAPI to fetch the signed file; Render free instances may sleep, and local uploads are lost on redeploy/restart. Re-upload after redeploy if a reference is missing. Render's file system is ephemeral: local uploads vanish on restart/redeploy and browser history alone cannot restore them. Generated media URLs can expire, so save the originals. For a long-term version, use private object storage and a database.

### API docs
- PiAPI Unified API: https://piapi.ai/docs/unified-api-schema
- PiAPI upload helper: https://app.piapi.ai/docs/tools/file-upload
- OpenAI API docs: https://platform.openai.com/docs/api-reference/chat
- Seedance 2.5 docs: https://piapi.ai/docs/seedance-api/seedance-25

OpenAI API billing is separate from ChatGPT Plus. PiAPI charges separately.

### Security
A signed, HTTP-only, Secure cookie protects the owner session; keys are only used server-side. This is for one trusted owner, not a multi-user SaaS. Change APP_PASSWORD in Render if anyone else knows it. For serious use, add cloud file storage, upload scanning, detailed costs/quotas, and stronger authentication.

**Troubleshooting:** If PiAPI returns `Invalid input` for Kling O1, the app now reports Kling-specific restrictions rather than Seedance's 4–30s warning. This patch is validated with mocked request unit tests but not a paid request to PiAPI. Check input file accessibility/format and provider status before retrying; do not retry automatically.

### Kling O1 debugging (October 2026)
PiAPI accepted an O1 reference request but reported task error 10003 (Invalid input), without consuming credits. The original implementation incorrectly sent a fixed `duration: 10` for video-editing references. Kling's upstream documentation says *duration cannot be specified for base-video editing*, so the request now omits duration. The Render signed-media route also now supports HEAD, which may be needed when PiAPI validates a video reference URL. **Neither suspected cause was conclusively confirmed by PiAPI**; this is a defensive fix. PiAPI's public models catalog still labels Kling O1 as "Coming soon" in some places, despite its documentation describing editing. Do not claim paid video editing is verified until tested successfully.
