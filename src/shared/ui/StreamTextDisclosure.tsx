import { ChevronDown } from "lucide-react";
import { memo, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface StreamTextDisclosureProps {
  label: string;
  icon: ReactNode;
  text: string;
  streaming: boolean;
  caption?: string;
}

/** The live preview belongs to the trigger; collapsing only hides the full text. */
export const StreamTextDisclosure = memo(function StreamTextDisclosure({
  label,
  icon,
  text,
  streaming,
  caption,
}: StreamTextDisclosureProps) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const viewportRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const expandedContentRef = useRef<HTMLDivElement>(null);
  const expandedFollowBottomRef = useRef(true);
  // The collapsed row shows only the latest non-empty reasoning line.
  // The complete stream remains available in the expanded panel.
  const preview = streaming
    ? text
        .replace(/\r\n?/gu, "\n")
        .split("\n")
        .map((line) => line.trim())
        .reverse()
        .find((line) => line.length > 0) || ""
    : "";

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = textRef.current;
    if (!viewport || !content) return;
    const follow = () => {
      viewport.scrollLeft = viewport.scrollWidth;
    };
    follow();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(follow);
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [preview, expanded, streaming]);

  useLayoutEffect(() => {
    const content = expandedContentRef.current;
    if (!content || !expanded) return;
    const follow = () => {
      if (streaming && expandedFollowBottomRef.current) {
        content.scrollTop = content.scrollHeight;
      }
    };
    follow();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    return () => observer.disconnect();
  }, [expanded, streaming, text]);

  const handleToggle = () => {
    setExpanded((value) => {
      if (!value) {
        expandedFollowBottomRef.current = true;
      }
      return !value;
    });
  };

  const handleExpandedScroll = () => {
    const content = expandedContentRef.current;
    if (!content) return;
    expandedFollowBottomRef.current =
      content.scrollHeight - content.clientHeight - content.scrollTop <= 2;
  };

  const summary = preview || caption || "";

  return (
    <section className="stream-text-disclosure" data-streaming={streaming}>
      <button
        className="stream-text-trigger"
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-label={`${expanded ? "收起" : "展开"}${label}`}
        onClick={handleToggle}
      >
        {icon}
        <span className="stream-text-label">{label}</span>
        {summary ? <span className="stream-text-separator" aria-hidden="true">·</span> : null}
        {!expanded && preview ? (
          <span className="stream-text-preview" ref={viewportRef} aria-hidden="true">
            <span ref={textRef}>{preview}</span>
          </span>
        ) : caption ? (
          <span className="stream-text-caption">{caption}</span>
        ) : null}
        <ChevronDown className="ui-icon stream-text-chevron" aria-hidden="true" />
      </button>
      {expanded ? (
        <div
          className="stream-text-content"
          id={contentId}
          ref={expandedContentRef}
          onScroll={handleExpandedScroll}
        >
          {text}
        </div>
      ) : null}
    </section>
  );
});
