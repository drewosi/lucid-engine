# Media policy

`media/` holds the committed demo assets the landing page and README point at. History is permanent: a
7 MB gif committed once is in every clone forever, so keep new binaries small.

## Rules

- No new binary over **1 MB** without asking (also in `CLAUDE.md`). `.gitattributes` marks `media/*` as binary so it is never diffed or merged; it cannot enforce a size limit, review does.
- Regenerate demo assets only at visual milestones (`scripts/record-demo.mjs`, `scripts/encode-demo.sh`, `scripts/capture-shots.mjs`), never in a fix-check loop.

## Today

| File | Size | Used by |
| --- | ---: | --- |
| `media/meridian-demo.gif` (720x450, 8 fps, 73 s) | 7.1 MB | `README.md` inline demo |
| `media/meridian-demo.mp4` (1280x800, 25 fps, 73 s, crf 23) | 3.6 MB | `index.html` video + `README.md` link |
| `media/meridian-poster.jpg`, `shot-*.jpg` | ~0.1 MB each | `index.html`, README |

## Proposal (not applied: needs the maintainer's approval)

Measured from the current mp4 with ffmpeg (scratch encodes, not committed):

| Candidate | Size |
| --- | ---: |
| mp4, 1280x800, crf 30, slow preset | 1.6 MB |
| mp4, 960 wide, crf 28, slow preset | 1.2 MB |
| animated webp, 800 wide, 8 fps | 13 MB (worse than the gif; ruled out) |

1. **Stop shipping the gif.** In the README, show `media/meridian-poster.jpg` (0.1 MB) as a linked image that opens the mp4, which saves 7.1 MB per clone going forward. A gif cannot get meaningfully smaller at this length without becoming unreadable.
2. **Re-encode the mp4 at crf 30** (`encode-demo.sh` currently uses crf 23): 3.6 MB to about 1.6 MB, still 1280x800 and still H.264 so it plays everywhere.
3. **Future large media goes to a GitHub Release asset**, not the tree. A video tag can point at a release download URL, but it redirects to another host, so it must be checked against the hosted CSP (`deploy/` and `app.html` meta) before the landing page depends on it. The landing page and README keep working from the tree until then.
4. Removing the two big files from *history* would need a rewrite and force-push; that is deliberately not proposed here. Removing them from the tree only stops further growth.
