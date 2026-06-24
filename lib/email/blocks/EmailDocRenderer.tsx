// lib/email/blocks/EmailDocRenderer.tsx — PURE (no "use client"). Wraps the
// block list in Html+Body+Container. Used by the render API route via
// render(EmailDocEmail({ doc })) — same proven pattern as DigestEmail.tsx.
import { Html, Head, Body, Container, Preview } from "@react-email/components";
import { BlockRenderer } from "./BlockRenderer";
import type { EmailDoc } from "../doc/types";

export function EmailDocEmail({ doc, preview }: { doc: EmailDoc; preview?: string }) {
  return (
    <Html lang="en">
      <Head />
      {preview ? <Preview>{preview}</Preview> : null}
      <Body style={{ backgroundColor: doc.globalStyle.backdropColor, margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: "600px", margin: "0 auto", backgroundColor: "#ffffff" }}>
          {doc.blocks.map((block) => (
            <BlockRenderer key={block.id} block={block} globalStyle={doc.globalStyle} />
          ))}
        </Container>
      </Body>
    </Html>
  );
}
