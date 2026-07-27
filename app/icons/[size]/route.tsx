import { ImageResponse } from "next/og";

const supportedSizes = new Set([180, 192, 512]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ size: string }> },
) {
  const { size: rawSize } = await context.params;
  const requestedSize = Number(rawSize);
  const size = supportedSizes.has(requestedSize) ? requestedSize : 512;
  const inset = Math.round(size * 0.14);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#183b32",
          color: "#fffdf8",
        }}
      >
        <div
          style={{
            width: size - inset * 2,
            height: size - inset * 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: `${Math.max(4, Math.round(size * 0.025))}px solid #d9e2d2`,
            borderRadius: Math.round(size * 0.12),
            color: "#fffdf8",
            fontFamily: "Georgia",
            fontSize: Math.round(size * 0.35),
            fontWeight: 700,
            letterSpacing: Math.round(size * -0.025),
          }}
        >
          JT
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control": "public, max-age=86400, immutable",
      },
    },
  );
}
