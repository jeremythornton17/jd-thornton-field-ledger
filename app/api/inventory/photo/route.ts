import { type NextRequest } from "next/server";
import { authErrorResponse, requireApiUser } from "@/lib/auth";
import { adminBucket, adminDb } from "@/lib/firebase-admin";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function photoPath(groupId: number) {
  return `field-ledger/groups/${groupId}`;
}

function parseGroupId(request: NextRequest) {
  const groupId = Number(request.nextUrl.searchParams.get("groupId"));
  return Number.isInteger(groupId) && groupId > 0 ? groupId : null;
}

function errorResponse(error: unknown, fallback: string) {
  return (
    authErrorResponse(error) ||
    Response.json(
      { error: error instanceof Error ? error.message : fallback },
      { status: 500 },
    )
  );
}

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request);
    const groupId = parseGroupId(request);
    if (!groupId) {
      return Response.json(
        { error: "A valid groupId is required." },
        { status: 400 },
      );
    }
    const file = adminBucket.file(photoPath(groupId));
    const [exists] = await file.exists();
    if (!exists) return new Response("Not found", { status: 404 });
    const [metadata] = await file.getMetadata();
    const [contents] = await file.download();
    return new Response(new Uint8Array(contents), {
      headers: {
        "content-type": metadata.contentType || "application/octet-stream",
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    return errorResponse(error, "Unable to load the photo.");
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireApiUser(request);
    const form = await request.formData();
    const groupId = Number(form.get("groupId"));
    const file = form.get("file");
    if (!Number.isInteger(groupId) || groupId <= 0) {
      return Response.json(
        { error: "A valid groupId is required." },
        { status: 400 },
      );
    }
    if (!(file instanceof File)) {
      return Response.json(
        { error: "A photo file is required." },
        { status: 400 },
      );
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return Response.json(
        { error: "Photos must be JPEG, PNG, or WebP." },
        { status: 400 },
      );
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return Response.json(
        { error: "Photos must be 5MB or smaller." },
        { status: 400 },
      );
    }
    const group = await adminDb
      .collection("fieldLedgerInventoryGroups")
      .doc(String(groupId))
      .get();
    if (!group.exists) {
      return Response.json(
        { error: "That inventory group no longer exists." },
        { status: 404 },
      );
    }
    await adminBucket.file(photoPath(groupId)).save(
      Buffer.from(await file.arrayBuffer()),
      {
        resumable: false,
        metadata: {
          contentType: file.type,
          cacheControl: "private, max-age=300",
        },
      },
    );
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Unable to upload the photo.");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireApiUser(request);
    const groupId = parseGroupId(request);
    if (!groupId) {
      return Response.json(
        { error: "A valid groupId is required." },
        { status: 400 },
      );
    }
    await adminBucket.file(photoPath(groupId)).delete({ ignoreNotFound: true });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Unable to delete the photo.");
  }
}
