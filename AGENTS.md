# Shared Melete UI

The user requires one UI codebase for the website and laptop player. The checkout's Windows name is a development location, not a separate product or UI variant.

- Implement common UI behavior in the shared template/ sources. A UI bug reported on the laptop is a shared Melete bug, including take-table ordering, recording controls, layout and filtering.
- Build one player release from one source revision for both website hosting and offline installation. Use the same release artifact and release manifest; verify matching hashes before reporting that the installations are synchronized.
- Keep platform differences in the optional native audio adapter, local host and device/latency configuration. Do not create platform-specific UI templates or gate ordinary UI fixes on Windows, localhost or native audio availability.
- Keep recordings, singer roster and device configuration external to the common release. Preserve existing edits in this checkout.
- Generated players and older checkouts are not independent UI source trees. Fix source first; rebuilding or a verified artifact update must preserve the common UI. Do not report a local-only installed fix as already available on the website.

Keep release changes and any unverified behavior in RELEASE_NOTES.md. A source push alone is not a website deployment. For a requested shared release, build once, publish the player and its manifest together, and verify the website and installed file against that manifest before claiming both are synchronized.
