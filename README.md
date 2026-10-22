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

### O1 source-video request correction
Official Kling Omni API documentation says **aspect ratio is unsupported for base-video edits** and duration is inherited from the source clip. This app now omits both `aspect_ratio` and `duration` from Kling O1 source-video edit payloads and explicitly specifies `config.service_mode: public`, matching PiAPI's documented example. This only fixes the request format; PiAPI's `10003 Invalid input` response does not specify which validation failed. Editing has not been validated with a successful real paid job and should be considered experimental until PiAPI confirms access and accepted source formats. Do not repeatedly submit failed inputs.


### Kling 3.0 Omni video + character reference (experimental)

This separate preset is not the existing "Kling 3.0" model. Select **Kling 3.0 Omni · Video + Character Reference (Experimental)** in the Production board. It uses PiAPI `model: kling`, `task_type: omni_video_generation`, `input.version: 3.0`, `video` (one MP4/MOV source URL), and `images` (1–4 reference image URLs) with `@video` and `@image_1` in the prompt; it keeps original audio when requested with `keep_original_audio`. Audio file uploads and multi-shot arrays are not supported together with video references.

Choose **Edit existing video** for this app's generation mode, 720p or 1080p, appropriate 9:16 / 16:9 / 1:1 aspect ratio, and 3–15 seconds. This preset **regenerates a video guided by a reference**; it is **not a guarantee of replacing a character without changing any pixels of the original environment**. Review the PiAPI cost warning before submitting; it does not charge unless you explicitly confirm and generate.

Public docs: https://app.piapi.ai/docs/kling-api/kling-3-omni-api
PiAPI's February 26, 2026 article said video-reference input was not yet supported through its API at that time. Its subsequently published API documentation describes video reference inputs, but availability and success for the current PiAPI account **have not been verified with a real paid job**. No automatic paid test or retry is implemented.


### Correction — Kling 3.0 Omni is not same-scene character replacement
The PiAPI docs explicitly say `input.video` is a reference for the generated video's *style/content*. A real result in this app animated the reference character image but did not retain the source scene. The Omni preset is now clearly labelled **Video Reference (Not a Swap)**, uses the **Create** operation, and gives a prominent warning before credit-bearing jobs. GPT guidance no longer suggests it for replacing a whole character inside the exact original video. This is a capability clarification, not a paid-generation fix.

For genuine whole-person replacement inside the existing footage, consider a dedicated **Wan 2.2 Animate Replace** service from fal.ai or Replicate, or **P-Video-Replace** from Runware. Those are separate providers, not supported by the current PiAPI key. Their outputs still need manual assessment.

### Nano Banana 2.1 character replacement for one frame (PiAPI key)

The Production Board now includes two options:

- **Nano Banana 2.1 · Replace Character (1 Frame)** sends exactly two uploaded images to PiAPI in order: the **original video frame first** and the **replacement character image second**. No mask is needed. Choose **Create**, a frame-matching aspect ratio, and 1K ($0.03), 2K ($0.04) or 4K ($0.09) for one image generation. The original frame plus character image are sent using documented `model: gemini`, `task_type: nano-banana-2.1`, `input.image_urls`.
- **Nano Banana 2.1 · Replace Character (Masked Frame)** uses the exact same **one-image-generation** PiAPI task. Before submitting, paint the subject inside Filmbuilder's touch-enabled canvas. The mask is saved as an extra local PNG upload **without adding it to PiAPI reference inputs**. On completion, tap **Restore original background · Download masked PNG**. Filmbuilder downloads the generated image through an authenticated, provider-output-only proxy, then locally composites edited pixels **inside** the painted selection over the original frame pixels **outside** the selection. No second generation or charge is incurred by the local compositing operation.

**Important:** PiAPI's Nano Banana 2.1 API does **not** document a native mask parameter. Character pose/identity and the edited foreground can still drift. Compositing may misalign if the model changes camera crop or subject position; match the output aspect ratio to the original frame. The mask and original asset must still be present on the Render instance when compositing; an app redeploy may remove temporary uploads. Outputs are limited to 2048 pixels on the longest side during compositing for mobile memory safety.

These options **edit one image frame, not a video**. They do not automatically extract all frames from an MP4, keep temporal consistency, or rebuild a movie. Any future full-video workflow must include explicit batch-cost confirmation.

Docs: https://app.piapi.ai/nano-banana-2-1
