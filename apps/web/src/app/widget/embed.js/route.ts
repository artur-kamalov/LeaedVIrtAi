import { NextResponse } from "next/server";

export function GET(request: Request) {
  const url = new URL(request.url);
  const publicKey = url.searchParams.get("key")?.trim() ?? "";
  const frameUrl = `${url.origin}/widget/frame`;
  const script = `
(() => {
  const current = document.currentScript;
  const key = current?.dataset?.leadvirtKey || ${JSON.stringify(publicKey)};
  if (!key) {
    console.warn("LeadVirt widget key is required. Add data-leadvirt-key to the embed script.");
    return;
  }
  const frameSrc = new URL(${JSON.stringify(frameUrl)});
  frameSrc.searchParams.set("key", key);
  const existing = document.querySelector('iframe[data-leadvirt-widget="true"]');
  if (existing) {
    existing.setAttribute("src", frameSrc.toString());
    return;
  }
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-leadvirt-widget", "true");
  iframe.setAttribute("title", "LeadVirt.ai chat widget");
  iframe.setAttribute("allow", "clipboard-write");
  iframe.src = frameSrc.toString();
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "430px",
    maxWidth: "100vw",
    height: "720px",
    maxHeight: "100vh",
    border: "0",
    background: "transparent",
    colorScheme: "normal",
    zIndex: "2147483647"
  });
  document.body.appendChild(iframe);
})();
`;

  return new NextResponse(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=60"
    }
  });
}
