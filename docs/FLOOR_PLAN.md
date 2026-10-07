# Floor plan: 25 upgrades to the 3D floor (look, build, people, walking, viewing)

Written 2026-10-07 from the code as it stands. Presentation only: nothing here places, sizes or refuses a trade, reads a gate, or touches `src/lib/aplus/config.ts`.
Tick the boxes as items land. One run = one working session = one commit to `main`, pushed and checked by hash.

## What exists today (checked in the code, so nothing below re-does it)

| Area | State | Where |
|------|-------|-------|
| Renderer | WebGL, ACES tone map, PCF shadows (2048, 1024 on mobile), 1 sun + hemisphere + 4 point lamps (points cast no shadow). **No environment map, no post-processing, no fog.** | `floor-scene.ts:1624-1687` |
| Office | `office.glb` 3.6 MB, ~90k triangles, 279 objects, flat PBR colours, **no textures, no baked light**. Naming contract checked by `verify-room.mjs`. | `public/floor/`, `scripts/blender/build_floor.py` |
| People | Procedural rigid parts (capsules, a sphere head) on joint groups; poses are maths (`poseFor`), eased by one exponential (k=12/s). Face = two eye spheres (a blink squashes them), one brow box, one mouth capsule scaled by a viseme. **Hands are single spheres (no fingers), shoes are boxes fixed to the shin (no ankle joint), no eyelids.** | `floor-scene.ts:568-1075`, `floor-presence.ts` |
| Lip sync | The viseme is chosen from the line's letters at 10 per second. Not audio, not word-timed. | `floor-presence.ts` |
| Walking | A* on a nav grid with string-pulling. **Constant 1.35 m/s, no acceleration, corners snap to waypoints, cadence = 4.4 x speed (not stride-matched), no avoidance between people.** | `floor-scene.ts:975-1000` |
| Doors | Gaps in the glass walls with door frames (head and transom); no door panels. | `floor-scene.ts:1923`, `build_floor.py:571-628` |
| Screens | Canvas textures, anisotropy 4, **mipmaps off** (shimmer at distance). | `floor-scene.ts:1997-2002` |
| Camera | Orbit + presets + follow/chase + director close-ups picked by line of sight + owner walk in 1st/3rd person. Strong already. | `floor-scene.ts:2300-2700` |
| Sound | Synthesised bed, off by default. **No footsteps, no positional audio.** | `floor-sound.ts` |
| Map | **None.** | |

Tooling present on this PC: Blender 5.2 (`C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`), Playwright + Chromium (`ms-playwright/chromium-1234`), dev server `desk` on port 8123 (`.claude/launch.json`), `window.__floor` in dev builds (`floor-scene.ts:1756`).

## How to run this (the whole protocol)

1. **Two tracks, separate worktrees.** Track A is TypeScript (`src/components/room/*`). Track B is Blender (`scripts/blender/*`, `public/floor/*`). They touch different files, so Run 3 can start while Run 1 is still going.
2. **`floor-scene.ts` is a 3.4k-line hot file** (at least 14 recent commits touch the Floor files). New logic goes in NEW modules (`floor-quality.ts`, `floor-post.ts`, `floor-locomotion.ts`, `floor-ik.ts`, `floor-hands.ts`, `floor-director.ts`, `floor-minimap.tsx`, `floor-audio3d.ts`) with a thin hook in `floor-scene.ts`. `git fetch` and rebase before every push.
3. **Every item ships with its own check** (the "Done when" line). **Every run ends with:** `tsc` exit 0, `verify-room.mjs`, `verify-floor-*.mjs`, the screenshot set from T1 reviewed by eye, and a fallback test (rename the new asset, the old look must still load).
4. **Budgets** (set by T1's baseline, then held): office <= 120k triangles and <= 2 MB after compression; each person <= 9k triangles, `crew.glb` <= 1.5 MB; draw calls and triangles per frame from `renderer.info` may not rise more than 15% in one run unless the quality governor (T2) gates the feature.
5. **Naming contract is law.** New office nodes use `geo_` or `door_`; crew parts use `crew_<Name>_<part>`. None may contain an emissive id or `key_<Name>` (the runtime substring-matches those).
6. **Stop points.** Every run is shippable alone. If usage is short, do Run 1 then Run 2 (all code, no Blender) and stop.
7. Sizes below are estimates, not measurements: S about an hour of agent work, M 2-4 hours, L half a day or more.

## Run 1: see it (Track A, code only)

- [ ] **T1 Test rig.** `scripts/floor-shots.mjs`: Playwright starts the `desk` server, opens the Floor tab, sets each camera preset through `window.__floor`, saves PNGs to `.cache/floor-shots/`, and writes `renderer.info` (draw calls, triangles, textures) to a baseline JSON. *Done when:* it runs in under 2 minutes and a second run reproduces the counts. Everything after is judged against this. **S**
- [ ] **T2 Quality governor.** `floor-quality.ts`: measures frame time over 2 s and steps high / medium / low (pixel ratio, shadow size, post passes, particle counts); a manual Auto / High / Low switch in the tab; shows `renderer.info`. *Done when:* forcing "low" visibly drops the costs in the info readout, and "auto" settles within 5 s. Gates L2, L4, V1. **M**
- [ ] **L1 Reflections and contact shadows.** A low-resolution `RoomEnvironment` PMREM as `scene.environment` at low intensity (glass, metal and screens finally reflect something); soft contact-shadow decals under people, the cat and chairs (point lamps cast no shadow). *Done when:* the glass walls and monitor bezels show a reflection in the screenshots and nobody floats. **S**
- [ ] **L2 Bloom and SMAA.** `floor-post.ts`: selective bloom on emissives (LED strips, beacon, rack LEDs, screens) plus SMAA (a composer drops MSAA); governor-gated, off on "low". *Done when:* LEDs glow, white walls do not, and "low" restores the old path exactly. **M**
- [ ] **L3 Screen sharpness.** Mipmaps on and anisotropy 8 for screen canvases, and a resolution step-up when the camera is within about 3 m (back down when far). *Done when:* a monitor flown to is crisp and a far TV no longer shimmers; texture memory change is read from `renderer.info`. **M**
- [ ] **L4 Light fakes.** Glow sprites on the pendant lamps, additive window light shafts that follow the ET clock and the VIX weather the windows already show, about 60 instanced dust motes inside the shafts. *Done when:* shafts appear by day, fade by night, and cost under 1 draw call each. **S**

## Run 2: walk it (Track A, code only)

- [ ] **M1 Locomotion v2.** `floor-locomotion.ts`: acceleration and braking, curved corners (Catmull-Rom through the string-pulled waypoints, clamped so a curve never leaves the walkable grid), lean into turns, stride length tied to speed so cadence matches ground covered, easing on arrival. *Done when:* `verify-room.mjs` reachability still passes, and a recorded path shows no waypoint snap (max yaw jump per frame under a set bound). **M**
- [ ] **M2 Foot planting and footstep events.** An ankle joint on the current rig; lock the stance foot while the body passes, heel-to-toe roll, emit a `footstep` event per plant (for V3). *Done when:* foot slide over a 10 m walk is under 2 cm in a test that integrates stance-foot velocity. **M**
- [ ] **M3 People avoid each other.** Separation steering plus yield rules at doors and narrow gaps, with a deterministic deadlock breaker (no random). *Done when:* two people sent through one door at once both arrive, none passes through the other, and `verify-room.mjs` still passes. **M**
- [ ] **M4 Sit, stand and couch transitions.** Pull the chair back, turn, lower, and the reverse; chairs move with the sitter; couch settle. Today the mode flips on arrival. *Done when:* a seat-to-stand cycle runs in three visible phases and the chair ends where it started. **M**

## Run 3: build it (Track B, Blender; can start with Run 1)

Step 0 before touching anything: run the existing build headless with Blender 5.2 and confirm `office.glb` round-trips identical (triangles, node names, size). The script header documents the `bpy` module route; the repo's earlier note is that 5.2.x builds a structurally identical model. Confirm the exact command line first.

- [ ] **D1 Baked ambient occlusion.** Bake AO per room in `build_floor.py` into vertex colours (no new image files), multiplied at runtime. Skills: `blender-lighting`, `lookdev`, `texture-workflow`. *Done when:* corners and under-desk areas darken in the screenshots and `office.glb` grows by under 15%. **L**
- [ ] **D2 Tiling material set.** Four 512 px tiles (carpet, wood, concrete, glass smear) with roughness variation, world-space UVs. Skills: `texture-workflow`, `blender-materials`, `blender-uv-texturing`. *Done when:* floors stop looking like flat colour, and the compressed GLB stays inside budget. **M**
- [ ] **D3 Set dressing.** Cable runs, posters, desk clutter, plant and shelf detail, floor wayfinding, in the existing stylised neon look. Skills: `set-dressing`, `prop-artist`, `environment-artist`, `stylized-style`, `neon-retrofuturism`. *Done when:* +15k triangles at most, `verify-room.mjs` name check passes. **M**
- [ ] **D4 Doors that open.** Sliding glass panels in each wall gap, named `door_<wall>_<i>`, opened at runtime when a person or the walking camera is within 1.4 m. *Done when:* the panel opens before the person arrives, closes after, and never blocks the nav grid. **M**
- [ ] **D5 Compression and distance culling.** Meshopt (or Draco) on the GLB, merge static duplicates, hide small props beyond a distance. Skills: `asset-optimization`, `lod-pipeline`. *Done when:* `office.glb` <= 2 MB, load time down, no node the runtime looks up is lost. **M**

## Run 4: the people (Track B then A)

- [ ] **C1 Character parts in Blender.** For each of the five (Gemma, Jax, Nova, Sterling, Vince): head with morph targets (viseme aa/ee/oh/mm, blink L/R, brow up/down, smile/frown), torso, upper arm, forearm, hand, thigh, shin, shoe, hair, their accessories. **Rigid parts, no skeleton**, so the existing joint groups drive them. Exported to `public/floor/crew.glb` as `crew_<Name>_<part>`. Skills: `blender-modeling`, `stylized-style` or `lowpoly-style`, `retopology`, `blender-materials`, `asset-optimization`. *Done when:* <= 9k triangles each, `crew.glb` <= 1.5 MB, portraits re-render from the same heads. **L**
- [ ] **C2 Binding and morph drivers.** Load `crew.glb`, attach each part to the matching joint group, drive `morphTargetInfluences` from the outputs `floor-presence.ts` already produces. Falls back to today's capsules if the file or any part is missing. *Done when:* renaming `crew.glb` brings the old people back unchanged, and the lip, brow and blink tests in `verify-floor-presence.mjs` still pass. **M**

## Run 5: the people move (Track A; needs Run 4, M5 needs C3)

- [ ] **C3 Hands.** Finger poses (open, point, fist, grip, typing) on the C1 hands, replacing today's sphere hands; a `Pose.hand` field per side, wired to POINTING, WRITING_ON_WHITEBOARD, CHECKING_TABLET and typing. *Done when:* the pointing gesture ends in an extended index finger toward the target. **M**
- [ ] **C4 Eyes and gaze.** Eyelid blinks on a natural interval, small saccades, eyes lead the head by about 120 ms toward the speaker, the board, the screen being quoted or the cat, with joint limits. *Done when:* in a two-person exchange the listener's gaze lands on the speaker within half a second of the line starting. **M**
- [ ] **C5 Real lip-sync timing.** Drive visemes from `SpeechSynthesisUtterance` word-boundary events at the voice's own rate, with today's letter clock as the fallback. **First step is a 10-minute probe** of which installed voices actually fire boundary events (this varies by voice and browser; the desktop pane only has the legacy voices). *Done when:* on a voice that fires events, mouth movement tracks word starts within one frame budget; on one that does not, behaviour is unchanged. **M**
- [ ] **C6 Idle life.** Breathing, weight shift, damped hair, tie and lanyard, head lag on turns. *Done when:* a still frame sequence of a standing person is never identical twice. **S**
- [ ] **M5 Arm IK reach.** Two-bone IK from shoulder to a world target: marker to a whiteboard point, finger to a screen or a price level, mug to the coffee machine, hands to keyboard and mouse. Uses the named screens' positions. *Done when:* the fingertip is within 3 cm of the target at the end of the reach. **M**

## Run 6: view it (Track A)

- [ ] **V1 Director v2.** Shot grammar: establishing, speaker medium, a listener reaction cutaway, an insert on the screen being quoted; critically damped moves, hold time by line length, cut on action when someone starts walking, depth of field on close-ups (governor-gated). Builds on the existing line-of-sight `closeShot`. *Done when:* over a recorded meeting no shot sits behind a wall and no two cuts are within 30 degrees of each other. **L**
- [ ] **V2 Minimap.** A canvas floor plan from `LAYOUT`: a dot per person with the name, the zones, the camera's view cone, click to fly there, click a dot to follow. None exists today. *Done when:* clicking a room flies the camera into it and the cone follows orbiting. **M**
- [ ] **V3 Spatial audio and footsteps.** WebAudio panners: footsteps by floor material off M2's events, door slides, keyboard clatter at occupied desks, the cat; distance falloff and a room-size tone. Respects the sound-off default. *Done when:* a walker passing left to right pans left to right, and with sound off nothing runs. **M**

## Fast path if usage is short

T1, T2, L1, L2, L3, M1, M3, V2: eight items, all code, no Blender, and every one is visible in the first minute on the Floor tab.

## Risks

- **Characters v2 is the only item that can regress the look.** Mitigation: rigid parts reuse every existing joint and animation; the capsule people stay as the fallback; a `?crew=procedural` switch for A/B.
- **Headless frame times are not a GPU measurement** (Chromium uses software GL here). T1 records counts, not fps; the governor decides speed on the trader's real machine.
- **A bloom composer removes MSAA.** SMAA replaces it (L2).
- **Blender 5.2 versus the documented 5.0.1.** Step 0 of Run 3 checks the round trip before any change.
- **`floor-scene.ts` churn from Grok.** New modules and rebase-before-push (protocol item 2).

## Not in this plan, and why

- **Full skeletal skinning and Audio2Face:** rigid parts reach the target look with the animation system already in place; Audio2Face needs a GPU or NVIDIA's cloud.
- **Godot, Spline, ComfyUI-3D, InstantMesh, Tripo as replacements, and chat-to-animation clip libraries:** declined before (`docs/TOOLING_PLAN.md`, "Next: the floor"): they discard the A* walk, the contract zones and the named screens, or cannot know whether a sweep was real.
- **A picture-in-picture second camera:** a second render target for a small payoff; revisit after V1.
- **`alpha-scene-gen`:** needs a paid account and spends credits.
