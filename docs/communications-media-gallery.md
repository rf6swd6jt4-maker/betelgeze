# Message media gallery

Chat videos display their saved preview with a centered play button. Clicking the preview opens the gallery and starts the player there; there is no separate Expand video link or inline player. A missing video thumbnail leaves the play button usable without downloading the original in chat.

The expanded viewer opens the selected image, sticker, or video from a message. Multi-media messages show a bottom thumbnail strip, position count, and previous/next chevrons. Arrow keys, horizontal trackpad scrolling, and touch/mouse drags navigate with a 200 ms slide transition. Short, vertical, and cancelled gestures stay on the current item; endpoints resist dragging. Trackpad momentum advances only one item per gesture. Reduced motion skips the transition.

Images retain contained pinch zoom and pan. Gallery swipes yield while zoomed or during a multi-touch gesture. Video controls at the top and bottom retain native interaction. Escape closes and restores focus. Leaving a video pauses and unmounts it. Autoplay attempts sound first; when rejected with NotAllowedError, it retries muted, retaining native unmute/play controls. Browser or device settings may still require a manual play tap ([MDN playback policy](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play)).

## Performance assessment

The gallery uses existing message metadata, with no database reads, message refreshes, signing batches, or provider calls. Only the selected original is newly requested. The outgoing, already loaded image remains mounted for at most 300 ms to complete the slide; outgoing video playback stops immediately. Adjacent items use previews and existing visibility admission, never eager original downloads. Movement changes only the track transform, without React state updates for every pointer move, animation libraries, or persistent frame loops. Chat video thumbnails participate in the existing bounded preview queue.

## Validation — 2026-09-12

- Repository suite: 884 passing tests; changed-file ESLint and whitespace check passed; production webpack build passed.
- Actual components exercised in isolated Chromium and WebKit at 390 x 844 and 1280 x 900: clickable video previews, real synthetic-video autoplay, playback cleanup, image/video navigation, mouse drags, horizontal wheel momentum, short and vertical drags, endpoints, native-control drag exclusion, pinch arbitration, keyboard navigation, reduced motion, and close cleanup. No JavaScript errors or page overflow.
- Chromium native touch input confirms that media follows the finger, pointer cancellation restores the same slide, and release settles the selected slide within the viewport.
- Request inspection confirms no video original loads before expansion and no unselected image originals load when opening a ten-image message.
- Screenshots inspected after playback/settling. Browser fixtures verify behavior, not production latency or physical iPhone/Safari/PWA gestures. Existing zoom math tests remain passing.

Client-only change, with no schema or provider configuration changes. Reverting the gallery, gesture hook, and attachment preview changes restores the previous behavior.
