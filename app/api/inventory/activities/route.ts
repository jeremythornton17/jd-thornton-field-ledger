import { type NextRequest } from "next/server";
import { authErrorResponse, requireApiUser } from "@/lib/auth";
import { listActivities, StoreError } from "@/lib/inventory-store";

function errorResponse(error: unknown) {
  const auth = authErrorResponse(error);
  if (auth) return auth;
  if (error instanceof StoreError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("[field-ledger activities] Unable to load the work log.", error);
  return Response.json({ error: "Unable to load the work log." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request);
    const cursorValue = request.nextUrl.searchParams.get("cursor");
    const limitValue = request.nextUrl.searchParams.get("limit");
    const cursorId = cursorValue ? Number(cursorValue) : undefined;
    const limit = limitValue ? Number(limitValue) : undefined;

    if (
      (cursorId !== undefined && (!Number.isInteger(cursorId) || cursorId <= 0)) ||
      (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200))
    ) {
      return Response.json({ error: "Invalid work-log page request." }, { status: 400 });
    }

    return Response.json(await listActivities({ cursorId, limit }));
  } catch (error) {
    return errorResponse(error);
  }
}
