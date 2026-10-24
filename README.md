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


### GPT Image 2.5 Flare and Sunburst — one-frame character editing (PiAPI)

Three presets use your **existing PiAPI API key**:

- **GPT Image 2.5 Flare · Character Replace (Frame)** — lower-latency-oriented image edits, original frame first, replacement character photo second, no mask.
- **GPT Image 2.5 Sunburst · Character Replace (Frame)** — precision-oriented editing with the same two inputs, no mask.
- **GPT Image 2.5 Sunburst · Character Replace (Native Mask)** — the same two inputs, plus a painted mask. Filmbuilder produces a native *transparent* PNG alpha mask at original image dimensions (transparent area = editable; opaque outside), submits it as PiAPI's multipart `mask` file along with the two `image[]` files, and retains the original black-and-white paint mask so you can optionally restore original background pixels afterward via **Restore original background · Download masked PNG**.

**These operate on ONE STILL FRAME ONLY.** Select **Create**. Upload **exactly two local JPG/PNG/WEBP images, original first, reference character second**. The app sends them as multipart file fields to `POST https://api.piapi.ai/api/v1/images/edits/async` using `X-API-Key`, *not* the unified PiAPI task endpoint or remote image-URL arrays. It polls `GET /api/v1/task/{id}`, decodes completed base64 image results on the server into a private temporary PNG, and returns only an authenticated same-origin image URL to the browser. No base64 content is saved in browser job history. PiAPI's async task image result may expire after roughly **60 minutes**; local Render files can also disappear after restart.

Output `size` is **1024×1024 for square, 1536×1024 for landscape, and 1024×1536 for portrait**. This can change framing relative to 16:9 or 9:16 originals, so native-mask results and composites should be visually reviewed for shifts. A native mask is *guidance*, not a pixel-perfect editing guarantee. The local composite ensures pixels outside the painted selection come from the uploaded source frame, though edges and alignment can still be imperfect.

Quality is **low, medium, high** (defaults to **low**). Flare and Sunburst have the same published **token rates** (text input $3.75 / million tokens; image input $6.00 / million; image output $22.50 / million), **NOT a fixed per-frame price**. The final cost depends on actual input/output tokens, image sizes, and quality. The app warns before submission, with no automatic retry or paid test.

Official docs: https://piapi.ai/docs/gpt-image/gpt-image-api
PiAPI walkthrough: https://piapi.ai/blogs/gpt-image-2-5-api-first-call-editing


### GPT Image 1.5 character replacement — simple and native mask

Filmbuilder offers two additional **single-frame** presets using the same PiAPI key and the same documented async edit endpoint as GPT Image 2.5:

- **GPT Image 1.5 · Character Replace (Frame)**: two uploaded pictures in order — **original video frame first, replacement character second**. Sends `model=gpt-image-1.5` and the two images as `image[]` fields, no mask. The app defaults to low quality.
- **GPT Image 1.5 · Character Replace (Native Mask)**: the same two images, plus a painted subject selection. The editor makes a PNG alpha mask for the source frame, uploads it with the PiAPI `mask` field, and offers the original-background composite download after generation. Native masks guide edits; they do not guarantee exact boundaries or identical pose.

**PiAPI advertises GPT Image 1.5 “from $0.009/image.”** That is an *estimated low-quality, square 1024×1024 output cost*, not an all-inclusive edit charge. PiAPI's estimated output-only prices are $0.009 (square low), $0.013 (portrait/landscape low), $0.034 (square medium), $0.051 (portrait/landscape medium), $0.133 (square high), and $0.200 (portrait/landscape high). Editing also incurs billed image-input tokens (both source and character reference). All charges vary with actual tokens. PiAPI's pricing table quotes GPT Image 1.5 at $8 per million input-image tokens, $32 per million output-image tokens and $5 per million text-input tokens. See [PiAPI GPT image API docs](https://piapi.ai/docs/gpt-image/gpt-image-api) for current figures.

**No automatic full-video processing**: These edit one still image/frame at a time, not an MP4, and do not ensure consistency between frames. No paid calls are made by automated tests or deployment. User confirmation is required before submitting a billable edit.


### Video Character Swap (experimental) — automated frame sequence with original audio

Select **Video Character Swap** in the sidebar. Upload a 10-second-or-shorter source MP4/MOV and a replacement character image in the regular References uploader, then select them in the Video Character Swap panel.

1. Choose GPT Image 1.5 (default), 2.5 Flare or Sunburst; `low`, `medium` or `high` image-editing quality; and **8, 12, 24 or 30 processed frames per second**. Default is 24 FPS for smoother motion. Choose 30 FPS for many phone source recordings; choose 8 or 12 to reduce paid edits (with choppier motion). Maximum 300 frames / 10 seconds. Changing FPS affects motion smoothness, **not** the video's nominal duration. Frames are downscaled for input (640px longest side, preserving aspect ratio), and the final MP4 is capped at 1280px longest side to stay within Render memory constraints.
2. Click **1. Prepare video frames (FREE)**. FFmpeg extracts frames and checks the exact count. The app displays the count and any published **low-quality GPT Image 1.5 output-only** price estimate (e.g., `8 × $0.013 = $0.104` for eight landscape frames). These values **exclude input-image tokens and all other charges** and are not a cost cap. Preparation does **not** call PiAPI.
3. Click **2. Pay for ONE preview frame** and approve the real PiAPI image-edit charge. Only the first original frame + character image are sent.
4. Review the FIRST edited frame carefully — it must completely replace the old character, including their original face, hair and clothing. It is saved as the **IMMUTABLE LOCKED FIRST-FRAME ANCHOR** when the preview completes. If happy, click **3. Approve remaining frames (PAID)** and enter the explicit confirmation phrase (for example `RUN 79`). Each subsequent frame uses the following ordered images:
   - **Image 1:** current original source-video frame — the ONLY authority for the current pose, expression, head angle, movement and background
   - **Image 2:** fixed replacement character reference — identity
   - **Image 3:** permanently locked first approved edited frame — the PRIMARY reference for the finished replacement's entire face, hair, clothing, and accessories. Never replaced by later generated frames
   - **Image 4:** optionally the immediately previous edited frame — SECONDARY temporal continuity guide; cannot override the locked frame's identity or clothing. Omitted on frame 2 because it is identical to Image 3, and omitted thereafter when the secondary continuity checkbox is off

   The strengthened prompt tells GPT to remove **all** visible old-character details rather than blend old and new outfits. This is not a guarantee: GPT Image still performs stochastic edits without automatic person segmentation, and the scene/motion may drift.
5. On completion, download the MP4. The server uses FFmpeg to rebuild at your selected FPS and mux the original soundtrack back in (AAC) if the source has audio and **Keep sound** was selected.

**Costs and safety:** Each frame submits a separate PiAPI GPT image edit, charged at actual variable output **and image-input token** rates. Output-only estimates cannot guarantee a total price, particularly for `medium`/`high`, the permanent third-image anchor, the optional fourth-image continuity reference, or long clips. Input-token costs may increase with additional reference images. There are **no automatic paid retries**. Every submitted frame is counted even if the provider times out. If a frame fails, the app stops. Successfully completed frames are saved in local temporary storage and may be resumed after reviewing whether the last PiAPI task was billed; never blindly retry unresolved task IDs. The current in-flight task may still be charged after stopping.

**Limits:** This first version uses unmasked edits. Automated segmentation and reliable motion-tracked per-frame masks are **not implemented**; the static one-frame mask editor is a separate feature. The video processing may be interrupted by free Render sleep/restarts or uploads expiring after redeployment, and temporary data is **not durable**. Scene-cut detection and automatic continuity resets are not implemented; for multiple shots, trim to one shot. Frame-to-frame visual consistency is an improvement strategy, **not guaranteed**. Sampling at 8/12fps makes motion choppier than 24/30fps. A 6.87-second video at 24 FPS submits ~165 paid frame edits, versus ~55 at 8 FPS. 30 FPS submits ~206 edits. More frames can also increase visible AI flicker. Videos longer than 10 seconds need trimming. For now the active queue allows one video-swap job at a time.

**Server build:** `npm test` installs `@ffmpeg-installer/ffmpeg` and runs the actual FFmpeg integration test. No real PiAPI provider calls occur during the test suite; all submitted-image tests use a mock provider.

**Phone rotation / portrait fix (October 2026):** Input MP4s can contain portrait display rotation metadata despite landscape encoded pixel dimensions. Video Swap now uses the orientation of the actual FFmpeg-extracted PNG (after autorotation) for PiAPI portrait/landscape size selection and final MP4 frame dimensions. A rotated-MP4 integration test verifies extraction at 30 FPS and portrait output.

### OpenAI Direct for Video Character Swap (October 2026)

The video character swap panel offers **OpenAI Direct** (default, billed to your OpenAI API account) or **PiAPI** (billed to PiAPI credits). Server-only OPENAI_API_KEY and PIAPI_API_KEY variables are used; no API keys are sent to the browser. The selected provider is saved with the job at free preparation time and cannot silently change mid-job.

OpenAI Direct calls POST https://api.openai.com/v1/images/edits with bearer authorization and multipart image[] files, using GPT Image 1.5, 2.5 Flare or 2.5 Sunburst. The first generated image is saved as an immutable anchor. Further edits use the current original video frame for pose and motion, the reference photo for identity, the locked first edited frame as the primary appearance reference, and optionally the previous edited frame as a fourth reference. Previous-frame continuity is unchecked by default to save input tokens.

**Paying:** Free frame preparation does not call either provider. The first-frame preview requires separate confirmation and the remaining frame sequence requires typed approval. Image edits are separately billed by the chosen API provider, including input and output tokens; ChatGPT subscriptions do not include OpenAI API credits. No accurate upper spend cap is guaranteed. A timed-out request can still be charged, so no automatic paid retries occur. PiAPI-specific output-only estimates are not displayed for OpenAI Direct. Automated tests mock both services and make no paid requests.

### Remove & Replace mask for video actor replacement

The Video Character Swap UI now defaults to **Remove & Replace (masked)**. This is materially different from merely strengthening the edit prompt. After FREE frame preparation, the user must drag a rectangle over the ENTIRE original person (face, hat, jacket, hair, shoulders, arms and hands, including their expected movement). The interface offers free original first, middle and last frame previews so the same region can be checked over time. **Save person-removal region (FREE)** validates and saves normalized coordinates without calling OpenAI or PiAPI. The first paid edit will be **blocked** if no valid region has been saved. Changing the area after a paid frame is prohibited: prepare a new job to change it.

During each paid source-frame edit, the server creates a same-resolution PNG native edit mask (alpha=0 in the marked area, alpha=255 outside) using the lightweight pngjs library. This mask is attached to both OpenAI Direct and PiAPI image edit requests. The prompt now explicitly requires replacing ALL the original actor's appearance in the masked zone, while still using the original frame for pose/motion and the locked first successful edited frame as the primary character identity. A mask does **not** trigger a separate paid provider request: still one edit per frame.

**Important limitations:** The selection is a static rectangle throughout the entire clip: **it does not track the actor automatically**. Select a region large enough to cover movement and inspect first/middle/last frames before paying. The GPT Image native mask is a *soft guide* to the model, **not a guarantee** that every piece of the old actor is removed or that background pixels remain identical. For moving subjects spanning most of the frame, dedicated AI person segmentation/motion tracking and a local background-preserving composite would be needed for stricter results; these are **not** implemented. There are no automatic paid retries. You can uncheck masked mode to retain legacy prompt-only editing, but it may still blend old and new people.

### Progressive video preview and four-frame credit gate (October 2026)

Video Character Swap now assembles a **playable, SILENT MP4 preview while the video is being edited**. As soon as two successful image edits exist, the server uses local FFmpeg to join those first frames at the configured FPS into a short MP4. It re-encodes the current rolling preview each time another paid frame successfully completes, saving it atomically and exposing it in the studio HTML5 video player. The video player updates as the number of processed frames grows; it can be paused, played and inspected before buying the remainder. Preview encoding is local and **requires no extra PiAPI/OpenAI image generation requests**, though it consumes some CPU on the Render instance. The video is silent while building. The *full* final MP4 is created after all paid frames are approved and generated; only then is the original uploaded video's audio muxed back in as AAC.

**Critical protection against 82 wasted shots:** approving the first preview still buys only one edit. The next button now buys **up to three more frame edits**, then **automatically stops** at four total frames and sets the state to **sample_ready**. The user can view the four-frame motion video before they decide whether the character looks correct. Full rendering cannot start without a distinct **RUN <remaining>** confirmation after this motion sample. Any request that tries to skip the four-frame stage is rejected by the server, regardless of the UI. The test flow is 1 frame + up to 3 more frames + an optional full-clip approval. If a video contains four or fewer edited frames, the sample comprises the whole video and the audio is assembled at completion. Resumed/interrupted jobs still respect the four-frame gate. Image quality is NOT guaranteed: a rolling preview helps catch blending early but is not a motion-control model or an automatic character-quality detector.

### Frame extraction on low-CPU Render (October 2026)

For high-resolution MP4/MOV phone recordings, the free Render service has a very small CPU allowance (observed 0.15 CPU), and the old FFmpeg frame-extraction task used to abort at 90 seconds with the message `Video operation exceeded time limit`. A failed preparation does **not** call either paid image API. Video Swap now uses fast-bilinear downscaling, PNG compression level 1, one decoding/filter thread, a six-minute preparation limit, and FFmpeg progress reporting in the job status. During free extraction, the first original frame is displayed as soon as FFmpeg reports it is ready, but **the first paid replacement preview is not unlocked until the whole video has been prepared successfully**. The original first-frame mask-selection and approval workflow remains unchanged. If preparation still fails after six minutes, prepare again using 8 FPS or a shorter/lower-resolution MP4; larger input video decoding can be slow on 0.15 CPU. There are zero API image-edit charges until an explicit paid preview approval. Uploaded videos and temporary extracted frames can disappear when Render restarts.
