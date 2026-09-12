# Message media gallery

Chat videos display their saved preview with a centered play button. Clicking the preview opens the gallery and starts the player there; there is no separate Expand video link or inline player. A missing video thumbnail leaves the play button usable without downloading the original in chat.

The expanded viewer opens the selected image, sticker, or video from a message. Multi-media messages show a bottom thumbnail strip, position count, and previous/next chevrons. Arrow keys, horizontal trackpad scrolling, and touch/mouse drags navigate with a 200 ms slide transition. Short, vertical, and cancelled gestures stay on the current item; endpoints resist dragging. Trackpad momentum advances only one item per gesture. Reduced motion skips the transition.

Images retain contained pinch zoom and pan. Gallery swipes yield while zoomed or during a multi-touch gesture. Video controls at the top and bottom retain native interaction. Escape closes and restores focus. Leaving a video pauses it while retaining its player and buffered media within the open viewer. Autoplay attempts sound first; when rejected with NotAllowedError, it retries muted, retaining native unmute/play controls. Browser or device settings may still require a manual play tap ([MDN playback policy](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play)).

## Performance assessment

The gallery uses existing message metadata without database reads, message refreshes, signing batches, or provider calls. The selected item starts immediately; after image decoding or video can-play-through, one background original loads at a time, prioritizing nearby items. A background video must report a fully buffered timeline before the queue advances; retained inactive players then use preload="none". Loaded images and paused players retain their DOM identity when revisited. Returning to a video resumes its existing playback position.

Admission uses a 96 MiB estimate: encoded size plus decoded image pixels, or a conservative video frame allowance. It bounds admitted residents, not actual browser allocation. Unknown metadata and files that do not fit remain on demand. Selection always works, evicting speculative items before previously viewed items if necessary. Selecting an in-flight preload promotes the same element. Changing selection, hidden documents, or playback buffering cancels speculative work; a 15-second timeout skips a stalled background item for this session. Errors do not loop; leaving a failed selected item releases it so an explicit return retries. Unfinished former selections are also cancelled during rapid navigation. Closing removes the gallery and clears video sources. Browsers can still evict buffers or decline video preload, so instant switching is not guaranteed for every file/device.

This replaces the earlier selected-only original policy only inside the explicitly opened gallery; the ordinary chat loading path is unchanged. No animation frame loop, media proxy, public cache, or persistent gallery cache was added.

## Validation — 2026-09-12

- Repository suite: 892 passing tests; changed-file ESLint and whitespace check passed; production webpack build passed.
- Actual components exercised in isolated Chromium and WebKit at 390 x 844 and 1280 x 900: clickable video previews, real synthetic-video autoplay, playback cleanup, image/video navigation, mouse drags, horizontal wheel momentum, short and vertical drags, endpoints, native-control drag exclusion, pinch arbitration, keyboard navigation, reduced motion, and close cleanup. No JavaScript errors or page overflow.
- Chromium native touch input confirms that media follows the finger, pointer cancellation restores the same slide, and release settles the selected slide within the viewport.
- Updated retention fixtures confirm no inline video original load before expansion, selected-first loading followed by at most one background original, and all ten small images eventually ready. Returning reuses the same image/player and adds no original requests in Chromium or WebKit. Closing stops the queue and clears video sources.
- The previous component replaced image/player elements on return under the same no-store fixture. Returning to a video made one additional original request in each baseline browser, versus zero with retention. Image HTTP requests were nevertheless reused by both browsers in that baseline, so no image-network savings claim is made from that test. The improvement demonstrated is retained elements/players and load-ahead readiness, not a measured production latency percentage.
- Eight session-policy tests cover promotion/cancellation, budget eviction and large selected items, failures/stalls, hidden/buffering suspension, unknown metadata, and late completions.
- Screenshots inspected after playback/settling. Browser fixtures verify behavior, not production latency or physical iPhone/Safari/PWA gestures. Existing zoom math tests remain passing.

Client-only change, with no schema or provider configuration changes. Reverting the gallery, gesture hook, and attachment preview changes restores the previous behavior.
