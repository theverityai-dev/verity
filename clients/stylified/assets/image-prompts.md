# Stylified identity mock: image prompts

Used in the Verity identity canvas (boards D and D light). Shared style line, repeated in every prompt so the set matches:

> Premium editorial product photography, soft diffused studio light, cool blue colour grade (deep graphite and near-black
> shadows, one accent of clear blue, #0A84FF), shallow depth of field, clean and uncluttered, no text, no logos, no
> watermark, no people's faces.

| # | file | purpose / where used | aspect | transparent | reference | prompt |
|---|------|----------------------|--------|-------------|-----------|--------|
| 1 | lot-spring-formals-thumb.png | Lot thumbnail, LOT-0001 Oxford formal full sleeve (floor cards, lot list) | square | no | none | A neatly folded light-blue Oxford cotton formal full-sleeve dress shirt, seen from above on a dark graphite surface, crisp collar and cuffs, visible fabric weave. Square composition, shirt centred with generous margin. + style line |
| 2 | lot-winter-flannel-thumb.png | Lot thumbnail, LOT-0002 Winter flannel check | square | no | #1 style | A neatly folded charcoal and navy flannel check shirt seen from above on a dark graphite surface, soft brushed texture. Square, centred, generous margin. + style line |
| 3 | lot-summer-poplin-thumb.png | Lot thumbnail, LOT-0003 Summer poplin half sleeve | square | no | #1 style | A neatly folded white and pale sky-blue fine stripe poplin half-sleeve shirt seen from above on a dark graphite surface. Square, centred, generous margin. + style line |
| 4 | lot-export-check-thumb.png | Lot thumbnail, LOT-0004 Export check shirt | square | no | #1 style | A neatly folded fine navy and white gingham check cotton shirt, pressed and export-ready, seen from above on a dark graphite surface. Square, centred, generous margin. + style line |
| 5 | banner-stitching-floor.png | Dashboard hero banner behind the glass hero card | wide 3:1 | no | none | Macro close-up of an industrial lockstitch sewing machine stitching a blue shirt collar, needle and presser foot sharp, thread spools softly out of focus, cool blue rim light, mostly dark. Wide 3:1 landscape, subject on the right third, dark empty space on the left for text. + style line |
| 6 | banner-fabric-rolls.png | Fabric and inventory header banner | wide 3:1 | no | #5 style | Rolls of shirting fabric (white, blue, navy, charcoal) stacked on steel racks in a tidy cutting room, cool soft light, shallow depth of field, mostly dark. Wide 3:1 landscape, rolls on the right, dark empty space on the left. + style line |
| 7 | evidence-collar-defect.png | Quality evidence photo attached to a rejected or rework entry | square | no | none | A phone-style close-up photograph of a pale blue shirt collar with a small visible loose thread pull and a skipped stitch, held on a cutting table, natural lighting, honest and slightly imperfect like a factory QC photo. Square, no text. No people. |
| 8 | empty-bundle-3d.png | Empty-state illustration for "No bundle here" | square | yes | #1 style | A single small tied bundle of cut shirt panels (light blue cloth stack tied with a thin cord and a tag with no writing), soft 3D render, matte, gentle shadow, cool blue light. Generous empty margin. Transparent background. + style line |

Karigar and user avatars are not generated: the product shows an uploaded photo when one exists and initials otherwise.

## Status (2026-10-22)

All eight generated through the ChatGPT web session, inspected, and kept on the first attempt. Full-size PNGs sit beside this file
(not committed, 2 to 4 MB each); the web-sized WebP copies in `web/` are the ones to use.

| # | file | status | web size | suggested alt |
|---|------|--------|----------|---------------|
| 1 | lot-spring-formals-thumb | kept | 640x640 | Folded light-blue Oxford formal shirt |
| 2 | lot-winter-flannel-thumb | kept (edit_image, #1 as style reference) | 640x640 | Folded charcoal and navy flannel check shirt |
| 3 | lot-summer-poplin-thumb | kept (edit_image, #1 as style reference) | 640x640 | Folded white and sky-blue striped half-sleeve shirt |
| 4 | lot-export-check-thumb | kept (edit_image, #1 as style reference) | 640x640 | Folded navy gingham check shirt |
| 5 | banner-stitching-floor | kept | 1800x600 | Sewing machine stitching a blue shirt collar |
| 6 | banner-fabric-rolls | kept | 1800x600 | Rolls of shirting fabric on steel racks |
| 7 | evidence-collar-defect | kept | 720x720 | Collar with a loose thread and a skipped stitch |
| 8 | empty-bundle-3d | kept, RGBA verified (65% fully clear) | 640x640 | A tied bundle of cut shirt panels |

Note: `edit_image` saves an echo of the reference as the first file and the real result as `-1`; the echo was deleted each time.
