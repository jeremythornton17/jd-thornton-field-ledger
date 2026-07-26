import { env } from "cloudflare:workers";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// One photo per group, keyed deterministically so uploading again just
// replaces it -- no separate column or lookup table needed to track it.
function photoKey(groupId: number) {
  return `groups/${groupId}`;
}

function parseGroupId(request: Request) {
  const groupId = Number(new URL(request.url).searchParams.get("groupId"));
  return Number.isInteger(groupId) && groupId > 0 ? groupId : null;
}

export async function GET(request: Request) {
  if (!env.PHOTOS) return Response.json({ error: "Photo storage is not configured." }, { status: 503 });
  const groupId = parseGroupId(request);
  if (!groupId) return Response.json({ error: "A valid groupId is required." }, { status: 400 });

  const object = await env.PHOTOS.get(photoKey(groupId));
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "private, max-age=300");
  return new Response(object.body, { headers });
}

export async function POST(request: Request) {
  if (!env.PHOTOS) return Response.json({ error: "Photo storage is not configured." }, { status: 503 });
  const form = await request.formData();
  const groupId = Number(form.get("groupId"));
  const file = form.get("file");

  if (!Number.isInteger(groupId) || groupId <= 0) {
    return Response.json({ error: "A valid groupId is required." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return Response.json({ error: "A photo file is required." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json({ error: "Photos must be JPEG, PNG, or WebP." }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return Response.json({ error: "Photos must be 5MB or smaller." }, { status: 400 });
  }

  const group = await env.DB.prepare("SELECT id FROM inventory_groups WHERE id = ?").bind(groupId).first();
  if (!group) return Response.json({ error: "That inventory group no longer exists." }, { status: 404 });

  await env.PHOTOS.put(photoKey(groupId), await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!env.PHOTOS) return Response.json({ error: "Photo storage is not configured." }, { status: 503 });
  const groupId = parseGroupId(request);
  if (!groupId) return Response.json({ error: "A valid groupId is required." }, { status: 400 });

  await env.PHOTOS.delete(photoKey(groupId));
  return Response.json({ ok: true });
}
