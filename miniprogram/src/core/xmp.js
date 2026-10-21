// Generated from web/src/core/xmp.ts. Run node miniprogram/scripts/build-core.cjs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractXmp = extractXmp;
exports.xmpNumber = xmpNumber;
exports.buildMotionPhotoXmp = buildMotionPhotoXmp;
exports.extractContentIdentifier = extractContentIdentifier;
const binary_1 = require("./binary");
const XMP_ENDINGS = ['<?xpacket end="w"?>', '<?xpacket end="r"?>', '</x:xmpmeta>'];
function extractXmp(bytes) {
    const candidates = [(0, binary_1.findAscii)(bytes, '<x:xmpmeta'), (0, binary_1.findAscii)(bytes, '<xmpmeta')].filter((value) => value >= 0);
    if (candidates.length === 0)
        return null;
    const start = Math.min(...candidates);
    let end = -1;
    for (const ending of XMP_ENDINGS) {
        const found = (0, binary_1.findAscii)(bytes, ending, start);
        if (found >= 0)
            end = Math.max(end, found + ending.length);
    }
    if (end < 0)
        end = Math.min(bytes.length, start + 64 * 1024);
    return (0, binary_1.ascii)(bytes, start, end - start).replaceAll('\u0000', '').trim();
}
function xmpNumber(xmp, ...names) {
    if (!xmp)
        return null;
    for (const name of names) {
        const escaped = name.replace(':', '\\:');
        const attribute = xmp.match(new RegExp(`${escaped}=["'](-?\\d+)["']`, 'i'));
        if (attribute)
            return Number(attribute[1]);
        const element = xmp.match(new RegExp(`<${escaped}>(-?\\d+)</${escaped}>`, 'i'));
        if (element)
            return Number(element[1]);
    }
    return null;
}
function buildMotionPhotoXmp(videoLength, videoOffset, timestampUs, videoMime, primaryPadding = 0) {
    return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
   xmlns:Camera="http://ns.google.com/photos/1.0/camera/"
   xmlns:GCamera="http://ns.google.com/photos/1.0/camera/"
   xmlns:Container="http://ns.google.com/photos/1.0/container/"
   xmlns:Item="http://ns.google.com/photos/1.0/container/item/"
   Camera:MotionPhoto="1"
   Camera:MotionPhotoVersion="1"
   Camera:MotionPhotoPresentationTimestampUs="${timestampUs}"
   GCamera:MicroVideo="1"
   GCamera:MicroVideoVersion="1"
   GCamera:MicroVideoOffset="${videoOffset}"
   GCamera:MicroVideoPresentationTimestampUs="${timestampUs}">
   <Container:Directory>
    <rdf:Seq>
     <rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Padding="${primaryPadding}" /></rdf:li>
     <rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="${videoMime}" Item:Semantic="MotionPhoto" Item:Length="${videoLength}" /></rdf:li>
    </rdf:Seq>
   </Container:Directory>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}
function extractContentIdentifier(bytes) {
    var _a;
    const text = (0, binary_1.ascii)(bytes, 0, Math.min(bytes.length, 4 * 1024 * 1024));
    const markerIndex = text.search(/com\.apple\.quicktime\.content\.identifier/i);
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
    if (markerIndex >= 0) {
        const nearby = text.slice(markerIndex, markerIndex + 512).match(uuid);
        if (nearby)
            return nearby[0].toLowerCase();
    }
    const any = text.match(uuid);
    return (_a = any === null || any === void 0 ? void 0 : any[0].toLowerCase()) !== null && _a !== void 0 ? _a : null;
}
