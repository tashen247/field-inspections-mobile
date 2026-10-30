# 0008: Photos are resized, watermarked and compressed on the device

**Status:** accepted

## Context

Phone cameras produce 3 to 8 MB images. Uploading those on mobile data is slow and costly, and
evidence photos need a tamper-evident time and place.

## Decision

After capture the app resizes to a 1600 px long edge (`expo-image-manipulator`), then draws the
image off-screen with Skia, burns in a caption bar (reference, shot, SAST timestamp, GPS and
accuracy), and encodes JPEG, stepping quality down until the file is under 500 KB. The file is
written to the document directory and its row inserted immediately, before any upload. Guided
shots come from the template, with example framing images that are cached for offline use.

## Consequences

- Uploads are about 10x smaller; 100 photos are roughly 50 MB.
- The watermark is part of the pixels, so it survives any later handling of the file.
- Processing costs a moment per photo on low-end devices; capture shows a busy state meanwhile.
