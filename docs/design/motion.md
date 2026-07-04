# Motion

- Motion serves meaning. It shows where something came from or where it went. If it does neither, cut it.
- A terminal has little motion to spend, so default to none and add deliberately. Most state changes are a clean swap, not an animation.
- Keep any motion fast. Slower feels broken.
- Move what carries meaning, and leave layout fixed. Never resize or reflow as an effect: a width or gutter that oscillates frame to frame thrashes layout and can wedge the renderer's scheduler (the fixed-width diff gutter exists for exactly this).
- Motion is interruptible. A new user action redirects it, it does not queue behind it.
- Motion is always optional. Honor a reduced-motion intent and keep a non-motion path; in a terminal that path is the default.
