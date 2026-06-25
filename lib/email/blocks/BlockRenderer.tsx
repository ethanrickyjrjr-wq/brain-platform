// lib/email/blocks/BlockRenderer.tsx — PURE. Switch on block.type → component.
// Shared by the canvas DOM view AND the server render() export. No "use client".
import type { EmailBlock, EmailGlobalStyle } from "../doc/types";
import { HeaderBlock } from "./HeaderBlock";
import { HeroBlock } from "./HeroBlock";
import { StatsBlock } from "./StatsBlock";
import { SignalBlock } from "./SignalBlock";
import { TextBlock } from "./TextBlock";
import { ImageBlock } from "./ImageBlock";
import { AgentCardBlock } from "./AgentCardBlock";
import { AgentHeroBlock } from "./AgentHeroBlock";
import { SocialIconsBlock } from "./SocialIconsBlock";
import { ButtonBlock } from "./ButtonBlock";
import { DividerBlock } from "./DividerBlock";
import { FooterBlock } from "./FooterBlock";

export function BlockRenderer({
  block,
  globalStyle,
}: {
  block: EmailBlock;
  globalStyle: EmailGlobalStyle;
}) {
  switch (block.type) {
    case "header":
      return <HeaderBlock props={block.props} globalStyle={globalStyle} />;
    case "hero":
      return <HeroBlock props={block.props} globalStyle={globalStyle} />;
    case "stats":
      return <StatsBlock props={block.props} globalStyle={globalStyle} />;
    case "signal":
      return <SignalBlock props={block.props} globalStyle={globalStyle} />;
    case "text":
      return <TextBlock props={block.props} globalStyle={globalStyle} />;
    case "image":
      return <ImageBlock props={block.props} globalStyle={globalStyle} />;
    case "agent-card":
      return <AgentCardBlock props={block.props} globalStyle={globalStyle} />;
    case "agent-hero":
      return <AgentHeroBlock props={block.props} globalStyle={globalStyle} />;
    case "social-icons":
      return <SocialIconsBlock props={block.props} globalStyle={globalStyle} />;
    case "button":
      return <ButtonBlock props={block.props} globalStyle={globalStyle} />;
    case "divider":
      return <DividerBlock props={block.props} globalStyle={globalStyle} />;
    case "footer":
      return <FooterBlock props={block.props} globalStyle={globalStyle} />;
    default:
      return null;
  }
}
